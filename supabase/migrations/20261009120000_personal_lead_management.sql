-- Personal lead management: confirmed contact, timed callbacks, call/activity history,
-- Do Not Call support, and server-side search.
--
-- ADDITIVE ONLY. No existing column, row, policy, or function is changed or dropped, so the
-- currently deployed app keeps working if this runs BEFORE the new app code (recommended order).
-- Leads stay personal: every function derives the owner from auth.uid(), never from input.

-- ---------------------------------------------------------------------------
-- 1. New columns on the personal lead row
-- ---------------------------------------------------------------------------
alter table public.leads
  add column if not exists contact_override_name text,
  add column if not exists contact_override_role text,
  add column if not exists contact_confirmed_at  timestamptz,
  add column if not exists callback_at           timestamptz,
  add column if not exists callback_timezone     text,
  add column if not exists reminder_completed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_contact_override_check') then
    alter table public.leads add constraint leads_contact_override_check check (
      (contact_override_name is null and contact_override_role is null and contact_confirmed_at is null)
      or (contact_override_name is not null and contact_override_role is not null and contact_confirmed_at is not null
          and char_length(contact_override_name) between 1 and 100
          and contact_override_role in ('owner','dispatcher','manager','other'))
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_callback_timezone_check') then
    alter table public.leads add constraint leads_callback_timezone_check check (
      callback_at is null or callback_timezone is not null
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_notes_length_check') then
    -- the API already clips notes to 5000; existing rows are well under this (checked: max < 2000)
    alter table public.leads add constraint leads_notes_length_check check (notes is null or char_length(notes) <= 5000);
  end if;
end $$;

-- Ownership of a lead can never be moved by an update (the existing UPDATE policy has no WITH CHECK).
create or replace function public.leads_protect_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.user_id is distinct from old.user_id
     or new.organization_id is distinct from old.organization_id
     or new.dot_number is distinct from old.dot_number then
    raise exception 'lead identity (dot_number, user_id, organization_id) cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leads_protect_identity on public.leads;
create trigger trg_leads_protect_identity before update on public.leads
  for each row execute function public.leads_protect_identity();

-- Indexes justified by the new queries (list/search/sort by recency, status filter, callback scan).
create index if not exists leads_user_updated_idx  on public.leads (user_id, updated_at desc, dot_number desc);
create index if not exists leads_user_status_idx   on public.leads (user_id, status);
create index if not exists leads_user_callback_idx on public.leads (user_id) where reminder_date is not null or callback_at is not null;

-- ---------------------------------------------------------------------------
-- 2. Append-only personal history
-- ---------------------------------------------------------------------------
create table if not exists public.lead_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  dot_number      bigint not null,
  event_type      text not null check (event_type in (
                    'dial_initiated','call_logged','status_changed',
                    'callback_set','callback_rescheduled','callback_completed','callback_cleared',
                    'contact_confirmed','contact_cleared')),
  occurred_at     timestamptz not null default now(),
  outcome         text,
  note            text check (note is null or char_length(note) <= 1000),
  details         jsonb,
  idempotency_key uuid
);

create unique index if not exists lead_events_idem_idx on public.lead_events (user_id, idempotency_key) where idempotency_key is not null;
create index if not exists lead_events_lead_idx on public.lead_events (user_id, dot_number, occurred_at desc, id desc);

alter table public.lead_events enable row level security;

drop policy if exists "Lead events visible to owner or same-org admin" on public.lead_events;
create policy "Lead events visible to owner or same-org admin" on public.lead_events
  for select using ((auth.uid() = user_id) or (is_admin() and organization_id = current_org_id()));

-- No INSERT/UPDATE/DELETE policies and no table privileges: history is written only by the
-- SECURITY DEFINER functions below and cannot be edited or deleted through ordinary access.
revoke all on public.lead_events from anon, authenticated;
grant select on public.lead_events to authenticated;
grant all on public.lead_events to service_role;

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
-- Cheap timezone check (pg_timezone_names is slow, about 7 ms per lookup).
create or replace function public._valid_tz(p_tz text)
returns boolean
language plpgsql
stable
set search_path = public
as $$
begin
  if p_tz is null or p_tz = '' then return false; end if;
  perform now() at time zone p_tz;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.lead_callback_bucket(
  p_status text, p_callback_at timestamptz, p_reminder_date date, p_done boolean, p_tz text)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when p_status = 'do_not_call' then null
    when p_callback_at is null and p_reminder_date is null then null
    when coalesce(p_done, false) then 'completed'
    when p_callback_at is not null then
      case
        when p_callback_at < now() then 'overdue'
        when (p_callback_at at time zone p_tz)::date = (now() at time zone p_tz)::date then 'today'
        else 'upcoming'
      end
    else
      case
        when p_reminder_date < (now() at time zone p_tz)::date then 'overdue'
        when p_reminder_date = (now() at time zone p_tz)::date then 'today'
        else 'upcoming'
      end
  end;
$$;

create or replace function public._lead_actor(out v_uid uuid, out v_org uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select organization_id into v_org from public.profiles where id = v_uid;
  if v_org is null then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Make sure the personal lead row exists (own user, own org). Needs the carrier to exist (FK).
create or replace function public._ensure_lead(p_dot bigint, p_uid uuid, p_org uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.leads (dot_number, user_id, organization_id)
  values (p_dot, p_uid, p_org)
  on conflict (dot_number, user_id) do nothing;
$$;

-- ---------------------------------------------------------------------------
-- 4. Status change (an edit — NOT a call)
-- ---------------------------------------------------------------------------
create or replace function public.set_lead_status(p_dot bigint, p_status text, p_key uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid; v_org uuid; v_old text; v_lead public.leads; v_inserted uuid;
begin
  select a.v_uid, a.v_org into v_uid, v_org from public._lead_actor() a;

  if not exists (select 1 from public.call_statuses where organization_id = v_org and value = p_status) then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  perform public._ensure_lead(p_dot, v_uid, v_org);
  select status into v_old from public.leads where dot_number = p_dot and user_id = v_uid for update;

  if v_old is distinct from p_status then
    insert into public.lead_events (organization_id, user_id, dot_number, event_type, details, idempotency_key)
    values (v_org, v_uid, p_dot, 'status_changed', jsonb_build_object('from', v_old, 'to', p_status), p_key)
    on conflict (user_id, idempotency_key) where idempotency_key is not null do nothing
    returning id into v_inserted;

    if p_key is null or v_inserted is not null then
      update public.leads set status = p_status where dot_number = p_dot and user_id = v_uid;
    end if;
  end if;

  select * into v_lead from public.leads where dot_number = p_dot and user_id = v_uid;
  return to_jsonb(v_lead);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Call attempt / call log (the only things that move last_called_at and the shift counter)
-- ---------------------------------------------------------------------------
create or replace function public.log_lead_call(
  p_dot bigint, p_key uuid, p_kind text, p_outcome text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid; v_org uuid; v_old text; v_event public.lead_events; v_lead public.leads; v_note text;
begin
  select a.v_uid, a.v_org into v_uid, v_org from public._lead_actor() a;

  if p_key is null then raise exception 'idempotency_key_required' using errcode = '22023'; end if;
  if p_kind not in ('dial_initiated','call_logged') then raise exception 'invalid_kind' using errcode = '22023'; end if;
  if p_outcome is not null and not exists (
       select 1 from public.call_statuses where organization_id = v_org and value = p_outcome) then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 1000 then raise exception 'note_too_long' using errcode = '22001'; end if;

  -- Replay of an earlier request: return what it produced, change nothing.
  select * into v_event from public.lead_events where user_id = v_uid and idempotency_key = p_key;
  if found then
    select * into v_lead from public.leads where dot_number = p_dot and user_id = v_uid;
    return jsonb_build_object('lead', to_jsonb(v_lead), 'event', to_jsonb(v_event), 'duplicate', true);
  end if;

  perform public._ensure_lead(p_dot, v_uid, v_org);
  select status into v_old from public.leads where dot_number = p_dot and user_id = v_uid for update;

  if p_kind = 'dial_initiated' and v_old = 'do_not_call' then
    raise exception 'do_not_call' using errcode = '42501';
  end if;

  insert into public.lead_events (organization_id, user_id, dot_number, event_type, outcome, note, idempotency_key)
  values (v_org, v_uid, p_dot, p_kind, p_outcome, v_note, p_key)
  on conflict (user_id, idempotency_key) where idempotency_key is not null do nothing
  returning * into v_event;

  if v_event.id is null then
    -- lost a race with an identical concurrent request
    select * into v_event from public.lead_events where user_id = v_uid and idempotency_key = p_key;
    select * into v_lead from public.leads where dot_number = p_dot and user_id = v_uid;
    return jsonb_build_object('lead', to_jsonb(v_lead), 'event', to_jsonb(v_event), 'duplicate', true);
  end if;

  update public.leads set last_called_at = v_event.occurred_at where dot_number = p_dot and user_id = v_uid;

  if p_kind = 'call_logged' then
    if p_outcome is not null and p_outcome is distinct from v_old then
      update public.leads set status = p_outcome where dot_number = p_dot and user_id = v_uid;
      insert into public.lead_events (organization_id, user_id, dot_number, event_type, details)
      values (v_org, v_uid, p_dot, 'status_changed', jsonb_build_object('from', v_old, 'to', p_outcome, 'via', 'call_log'));
    end if;
    -- counts explicit call logs (once, because the request is idempotent)
    update public.shifts set carriers_logged = carriers_logged + 1
    where id = (select id from public.shifts where user_id = v_uid and check_out is null order by check_in desc limit 1);
  end if;

  select * into v_lead from public.leads where dot_number = p_dot and user_id = v_uid;
  return jsonb_build_object('lead', to_jsonb(v_lead), 'event', to_jsonb(v_event), 'duplicate', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Callbacks (timed + timezone, or legacy date-only)
-- ---------------------------------------------------------------------------
create or replace function public.set_lead_callback(
  p_dot bigint, p_key uuid, p_at timestamptz, p_tz text, p_date date, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid; v_org uuid; v_lead public.leads; v_had boolean; v_inserted uuid; v_note text; v_local_date date;
begin
  select a.v_uid, a.v_org into v_uid, v_org from public._lead_actor() a;

  if (p_at is null) = (p_date is null) then
    raise exception 'give_either_timed_or_date_only' using errcode = '22023';
  end if;
  if p_at is not null then
    if not public._valid_tz(p_tz) then
      raise exception 'invalid_timezone' using errcode = '22023';
    end if;
    v_local_date := (p_at at time zone p_tz)::date;
  else
    v_local_date := p_date;
  end if;
  if v_local_date > (now() + interval '3 years')::date then raise exception 'callback_too_far' using errcode = '22023'; end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 1000 then raise exception 'note_too_long' using errcode = '22001'; end if;

  perform public._ensure_lead(p_dot, v_uid, v_org);
  select * into v_lead from public.leads where dot_number = p_dot and user_id = v_uid for update;
  if v_lead.status = 'do_not_call' then raise exception 'do_not_call' using errcode = '42501'; end if;

  v_had := (v_lead.reminder_date is not null or v_lead.callback_at is not null) and not v_lead.reminder_done;

  insert into public.lead_events (organization_id, user_id, dot_number, event_type, note, details, idempotency_key)
  values (v_org, v_uid, p_dot, case when v_had then 'callback_rescheduled' else 'callback_set' end, v_note,
          jsonb_build_object('at', p_at, 'timezone', p_tz, 'date', v_local_date), p_key)
  on conflict (user_id, idempotency_key) where idempotency_key is not null do nothing
  returning id into v_inserted;

  if p_key is null or v_inserted is not null then
    update public.leads set
      callback_at = p_at,
      callback_timezone = case when p_at is null then null else p_tz end,
      reminder_date = v_local_date,
      reminder_note = v_note,
      reminder_done = false,
      reminder_completed_at = null
    where dot_number = p_dot and user_id = v_uid;
  end if;

  select * into v_lead from public.leads where dot_number = p_dot and user_id = v_uid;
  return to_jsonb(v_lead);
end;
$$;

create or replace function public.complete_lead_callback(p_dot bigint, p_key uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid; v_org uuid; v_lead public.leads; v_inserted uuid;
begin
  select a.v_uid, a.v_org into v_uid, v_org from public._lead_actor() a;
  select * into v_lead from public.leads where dot_number = p_dot and user_id = v_uid for update;
  if not found then raise exception 'lead_not_found' using errcode = 'P0002'; end if;

  if (v_lead.reminder_date is not null or v_lead.callback_at is not null) and not v_lead.reminder_done then
    insert into public.lead_events (organization_id, user_id, dot_number, event_type, details, idempotency_key)
    values (v_org, v_uid, p_dot, 'callback_completed',
            jsonb_build_object('at', v_lead.callback_at, 'timezone', v_lead.callback_timezone, 'date', v_lead.reminder_date), p_key)
    on conflict (user_id, idempotency_key) where idempotency_key is not null do nothing
    returning id into v_inserted;
    if p_key is null or v_inserted is not null then
      update public.leads set reminder_done = true, reminder_completed_at = now() where dot_number = p_dot and user_id = v_uid;
    end if;
  end if;

  select * into v_lead from public.leads where dot_number = p_dot and user_id = v_uid;
  return to_jsonb(v_lead);
end;
$$;

create or replace function public.clear_lead_callback(p_dot bigint, p_key uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid; v_org uuid; v_lead public.leads; v_inserted uuid;
begin
  select a.v_uid, a.v_org into v_uid, v_org from public._lead_actor() a;
  select * into v_lead from public.leads where dot_number = p_dot and user_id = v_uid for update;
  if not found then raise exception 'lead_not_found' using errcode = 'P0002'; end if;

  if v_lead.reminder_date is not null or v_lead.callback_at is not null then
    insert into public.lead_events (organization_id, user_id, dot_number, event_type, details, idempotency_key)
    values (v_org, v_uid, p_dot, 'callback_cleared',
            jsonb_build_object('at', v_lead.callback_at, 'timezone', v_lead.callback_timezone, 'date', v_lead.reminder_date), p_key)
    on conflict (user_id, idempotency_key) where idempotency_key is not null do nothing
    returning id into v_inserted;
    if p_key is null or v_inserted is not null then
      update public.leads set callback_at = null, callback_timezone = null, reminder_date = null,
             reminder_note = null, reminder_done = false, reminder_completed_at = null
      where dot_number = p_dot and user_id = v_uid;
    end if;
  end if;

  select * into v_lead from public.leads where dot_number = p_dot and user_id = v_uid;
  return to_jsonb(v_lead);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Confirmed contact override (per agent, never on the shared carrier row)
-- ---------------------------------------------------------------------------
create or replace function public.set_lead_contact(p_dot bigint, p_key uuid, p_name text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid; v_org uuid; v_lead public.leads; v_name text; v_inserted uuid;
begin
  select a.v_uid, a.v_org into v_uid, v_org from public._lead_actor() a;
  v_name := btrim(coalesce(p_name, ''));
  if char_length(v_name) < 1 or char_length(v_name) > 100 then raise exception 'invalid_contact_name' using errcode = '22023'; end if;
  if p_role not in ('owner','dispatcher','manager','other') then raise exception 'invalid_contact_role' using errcode = '22023'; end if;

  perform public._ensure_lead(p_dot, v_uid, v_org);

  insert into public.lead_events (organization_id, user_id, dot_number, event_type, details, idempotency_key)
  values (v_org, v_uid, p_dot, 'contact_confirmed', jsonb_build_object('name', v_name, 'role', p_role), p_key)
  on conflict (user_id, idempotency_key) where idempotency_key is not null do nothing
  returning id into v_inserted;

  if p_key is null or v_inserted is not null then
    update public.leads set contact_override_name = v_name, contact_override_role = p_role, contact_confirmed_at = now()
    where dot_number = p_dot and user_id = v_uid;
  end if;

  select * into v_lead from public.leads where dot_number = p_dot and user_id = v_uid;
  return to_jsonb(v_lead);
end;
$$;

create or replace function public.clear_lead_contact(p_dot bigint, p_key uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid; v_org uuid; v_lead public.leads; v_inserted uuid;
begin
  select a.v_uid, a.v_org into v_uid, v_org from public._lead_actor() a;
  select * into v_lead from public.leads where dot_number = p_dot and user_id = v_uid for update;
  if not found then raise exception 'lead_not_found' using errcode = 'P0002'; end if;

  if v_lead.contact_override_name is not null then
    insert into public.lead_events (organization_id, user_id, dot_number, event_type, details, idempotency_key)
    values (v_org, v_uid, p_dot, 'contact_cleared', jsonb_build_object('name', v_lead.contact_override_name, 'role', v_lead.contact_override_role), p_key)
    on conflict (user_id, idempotency_key) where idempotency_key is not null do nothing
    returning id into v_inserted;
    if p_key is null or v_inserted is not null then
      update public.leads set contact_override_name = null, contact_override_role = null, contact_confirmed_at = null
      where dot_number = p_dot and user_id = v_uid;
    end if;
  end if;

  select * into v_lead from public.leads where dot_number = p_dot and user_id = v_uid;
  return to_jsonb(v_lead);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Search / filter / paginate (runs as the caller: RLS still applies)
--    Sort keys come from a fixed whitelist and every value is a bound parameter, so nothing the user
--    types is ever spliced into SQL. Only the requested page (not the whole set) is shaped into JSON.
-- ---------------------------------------------------------------------------
create or replace function public.search_leads(
  p_q text default null, p_status text default null,
  p_important boolean default false, p_saved boolean default false,
  p_callback text default null, p_dnc boolean default false,
  p_tz text default 'UTC', p_limit integer default 25, p_offset integer default 0,
  p_sort text default 'recent', p_user_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_uid uuid := coalesce(p_user_id, auth.uid());
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_pat text; v_digits text; v_where text; v_order text; v_total bigint; v_rows jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'invalid_limit' using errcode = '22023'; end if;
  if p_offset is null or p_offset < 0 then raise exception 'invalid_offset' using errcode = '22023'; end if;
  if coalesce(p_callback,'') not in ('','overdue','today','upcoming','completed','any') then raise exception 'invalid_callback' using errcode = '22023'; end if;
  if not public._valid_tz(p_tz) then raise exception 'invalid_timezone' using errcode = '22023'; end if;

  v_order := case p_sort
    when 'recent'   then 'l.updated_at desc, l.dot_number desc'
    when 'oldest'   then 'l.updated_at asc, l.dot_number asc'
    when 'priority' then 'l.priority desc, l.updated_at desc, l.dot_number desc'
    when 'name'     then 'lower(coalesce(c.legal_name, '''')) asc, l.dot_number asc'
    when 'callback' then 'coalesce(l.callback_at, (l.reminder_date::timestamp at time zone $7)) asc nulls last, l.dot_number asc'
    else null end;
  if v_order is null then raise exception 'invalid_sort' using errcode = '22023'; end if;

  if v_q is not null then
    v_q := left(v_q, 100);
    v_pat := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_digits := regexp_replace(v_q, '\D', '', 'g');
    if char_length(v_digits) < 3 then v_digits := null; end if;
  end if;

  v_where := $w$
        l.user_id = $1
    and ($2 is null or $2 = '' or l.status = $2)
    and (not coalesce($3, false) or l.priority)
    and (not coalesce($4, false) or l.saved)
    and (not coalesce($5, false) or l.status = 'do_not_call')
    and (case
           when coalesce($6, '') = '' then true
           when $6 = 'any' then public.lead_callback_bucket(l.status, l.callback_at, l.reminder_date, l.reminder_done, $7) is not null
           else public.lead_callback_bucket(l.status, l.callback_at, l.reminder_date, l.reminder_done, $7) = $6
         end)
    and ($8 is null
         or c.legal_name ilike $8 escape '\' or c.dba_name ilike $8 escape '\'
         or l.dot_number::text like $8 escape '\' or c.docket_number::text like $8 escape '\'
         or ($9 is not null and (regexp_replace(coalesce(c.phone,''), '\D', '', 'g') like '%' || $9 || '%'
              or regexp_replace(coalesce(c.cell_phone,''), '\D', '', 'g') like '%' || $9 || '%')))
  $w$;

  execute 'select count(*) from public.leads l left join public.carriers c on c.dot_number = l.dot_number where ' || v_where
    into v_total using v_uid, p_status, p_important, p_saved, p_dnc, p_callback, p_tz, v_pat, v_digits;

  execute format($p$
    select coalesce(jsonb_agg(t.j order by t.ord), '[]'::jsonb) from (
      select i.j, row_number() over () as ord from (
        select to_jsonb(l)
               || jsonb_build_object(
                    'bucket', public.lead_callback_bucket(l.status, l.callback_at, l.reminder_date, l.reminder_done, $7),
                    'due_at', coalesce(l.callback_at, (l.reminder_date::timestamp at time zone $7)),
                    'carriers', jsonb_build_object(
                      'legal_name', c.legal_name, 'dba_name', c.dba_name, 'phone', c.phone,
                      'phy_city', c.phy_city, 'phy_state', c.phy_state, 'power_units', c.power_units,
                      'docket_prefix', c.docket_prefix, 'docket_number', c.docket_number)) as j
        from public.leads l
        left join public.carriers c on c.dot_number = l.dot_number
        where %2$s
        order by %1$s
        limit $10 offset $11
      ) i
    ) t $p$, v_order, v_where)
    into v_rows using v_uid, p_status, p_important, p_saved, p_dnc, p_callback, p_tz, v_pat, v_digits, p_limit, p_offset;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;

create or replace function public.lead_callback_counts(p_tz text default 'UTC', p_user_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare v_uid uuid := coalesce(p_user_id, auth.uid()); v_out jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public._valid_tz(p_tz) then raise exception 'invalid_timezone' using errcode = '22023'; end if;

  select jsonb_build_object(
    'overdue',   count(*) filter (where b = 'overdue'),
    'today',     count(*) filter (where b = 'today'),
    'upcoming',  count(*) filter (where b = 'upcoming'),
    'completed', count(*) filter (where b = 'completed'),
    'dnc',       (select count(*) from public.leads where user_id = v_uid and status = 'do_not_call'))
  into v_out
  from (
    select public.lead_callback_bucket(l.status, l.callback_at, l.reminder_date, l.reminder_done, p_tz) as b
    from public.leads l
    where l.user_id = v_uid and (l.reminder_date is not null or l.callback_at is not null)
  ) x;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Function privileges: signed-in users only
-- ---------------------------------------------------------------------------
revoke all on function public._valid_tz(text) from public, anon;
revoke all on function public.lead_callback_bucket(text, timestamptz, date, boolean, text) from public, anon;
revoke all on function public._lead_actor() from public, anon, authenticated;
revoke all on function public._ensure_lead(bigint, uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_lead_status(bigint, text, uuid) from public, anon;
revoke all on function public.log_lead_call(bigint, uuid, text, text, text) from public, anon;
revoke all on function public.set_lead_callback(bigint, uuid, timestamptz, text, date, text) from public, anon;
revoke all on function public.complete_lead_callback(bigint, uuid) from public, anon;
revoke all on function public.clear_lead_callback(bigint, uuid) from public, anon;
revoke all on function public.set_lead_contact(bigint, uuid, text, text) from public, anon;
revoke all on function public.clear_lead_contact(bigint, uuid) from public, anon;
revoke all on function public.search_leads(text, text, boolean, boolean, text, boolean, text, integer, integer, text, uuid) from public, anon;
revoke all on function public.lead_callback_counts(text, uuid) from public, anon;

grant execute on function public._valid_tz(text) to authenticated;
grant execute on function public.lead_callback_bucket(text, timestamptz, date, boolean, text) to authenticated;
grant execute on function public.set_lead_status(bigint, text, uuid) to authenticated;
grant execute on function public.log_lead_call(bigint, uuid, text, text, text) to authenticated;
grant execute on function public.set_lead_callback(bigint, uuid, timestamptz, text, date, text) to authenticated;
grant execute on function public.complete_lead_callback(bigint, uuid) to authenticated;
grant execute on function public.clear_lead_callback(bigint, uuid) to authenticated;
grant execute on function public.set_lead_contact(bigint, uuid, text, text) to authenticated;
grant execute on function public.clear_lead_contact(bigint, uuid) to authenticated;
grant execute on function public.search_leads(text, text, boolean, boolean, text, boolean, text, integer, integer, text, uuid) to authenticated;
grant execute on function public.lead_callback_counts(text, uuid) to authenticated;
