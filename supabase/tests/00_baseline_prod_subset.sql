-- RECONSTRUCTED from the production schema inspected on 2026-10-09 (columns, constraints,
-- indexes, triggers, helper functions, RLS policies, grants). Used ONLY on a scratch database
-- to test the migration. It is not a dump and not a migration.
create schema if not exists auth;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public, auth to anon, authenticated, service_role;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(), name text not null,
  created_at timestamptz not null default now(), timezone text not null default 'UTC',
  idle_timeout_minutes integer not null default 120);
create table public.profiles (
  id uuid primary key, organization_id uuid not null references public.organizations(id),
  full_name text, role text not null default 'rep', is_super_admin boolean not null default false,
  created_at timestamptz not null default now(), last_seen_at timestamptz, scan_state jsonb,
  attendance_shift_type_id uuid);
create table public.call_statuses (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  value text not null, label text not null, color text not null default 'slate', sort_order integer not null default 0,
  is_default boolean not null default false, created_at timestamptz not null default now(),
  constraint call_statuses_org_value_key unique (organization_id, value),
  constraint call_statuses_color_check check (color = any (array['slate','blue','green','red','amber','violet'])));
create table public.carriers (
  dot_number bigint primary key, docket_prefix text, docket_number bigint, legal_name text, dba_name text,
  phone text, cell_phone text, email text, phy_city text, phy_state text, power_units integer, status_code text,
  motus_details jsonb);
create table public.leads (
  dot_number bigint not null references public.carriers(dot_number),
  user_id uuid not null references public.profiles(id),
  organization_id uuid not null references public.organizations(id),
  status text not null default 'new', priority boolean not null default false, notes text,
  last_called_at timestamptz, reminder_date date, reminder_note text, reminder_done boolean not null default false,
  saved boolean not null default false, saved_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (dot_number, user_id),
  constraint leads_status_fkey foreign key (organization_id, status) references public.call_statuses(organization_id, value) on update cascade);
create index idx_leads_status on public.leads (status);
create index leads_user_saved_idx on public.leads (user_id) where saved;
create table public.shifts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id), check_in timestamptz not null default now(),
  check_out timestamptz, carriers_viewed integer not null default 0, carriers_logged integer not null default 0);

create function public.set_updated_at() returns trigger language plpgsql set search_path = public as
  $$ begin new.updated_at = now(); return new; end; $$;
create trigger trg_leads_updated_at before update on public.leads for each row execute function public.set_updated_at();
create function public.current_org_id() returns uuid language sql stable security definer set search_path = public as
  $$ select organization_id from public.profiles where id = auth.uid(); $$;
create function public.is_admin() returns boolean language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'); $$;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.call_statuses enable row level security;
alter table public.carriers enable row level security;
alter table public.leads enable row level security;
alter table public.shifts enable row level security;

create policy "Statuses visible within own org" on public.call_statuses for select using (organization_id = current_org_id());
create policy "Authenticated users can read carriers cache" on public.carriers for select using (auth.uid() is not null);
create policy "Profiles visible" on public.profiles for select using (id = auth.uid() or organization_id = current_org_id());
create policy "Leads visible to owner or same-org admin" on public.leads for select using ((auth.uid() = user_id) or (is_admin() and organization_id = current_org_id()));
create policy "Leads insert by owner in their own org" on public.leads for insert with check ((auth.uid() = user_id) and (organization_id = current_org_id()));
create policy "Leads update by owner or same-org admin" on public.leads for update using ((auth.uid() = user_id) or (is_admin() and organization_id = current_org_id()));
create policy "Leads delete by owner or same-org admin" on public.leads for delete using ((auth.uid() = user_id) or (is_admin() and organization_id = current_org_id()));
create policy "Shifts visible to owner or same-org admin" on public.shifts for select using ((auth.uid() = user_id) or (is_admin() and organization_id = current_org_id()));
create policy "Shifts managed by owner in their own org" on public.shifts for insert with check ((auth.uid() = user_id) and (organization_id = current_org_id()));
create policy "Shifts update by owner" on public.shifts for update using (auth.uid() = user_id);

-- Supabase default privileges: everything granted, RLS does the protecting.
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;
