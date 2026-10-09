\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

\set a1 '11111111-1111-1111-1111-111111111111'
\set a2 '22222222-2222-2222-2222-222222222222'
\set admA '33333333-3333-3333-3333-333333333333'
\set b1 '44444444-4444-4444-4444-444444444444'
\set admB '55555555-5555-5555-5555-555555555555'
\set as_a1   'reset role; select set_config(''request.jwt.claim.sub'', ''11111111-1111-1111-1111-111111111111'', false); set role authenticated;'
\set as_a2   'reset role; select set_config(''request.jwt.claim.sub'', ''22222222-2222-2222-2222-222222222222'', false); set role authenticated;'
\set as_admA 'reset role; select set_config(''request.jwt.claim.sub'', ''33333333-3333-3333-3333-333333333333'', false); set role authenticated;'
\set as_b1   'reset role; select set_config(''request.jwt.claim.sub'', ''44444444-4444-4444-4444-444444444444'', false); set role authenticated;'
\set as_admB 'reset role; select set_config(''request.jwt.claim.sub'', ''55555555-5555-5555-5555-555555555555'', false); set role authenticated;'
\set as_anon 'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'
\set as_su   'reset role; select set_config(''request.jwt.claim.sub'', '''', false);'

reset role;
create or replace function public.t_assert(ok boolean, name text) returns void language plpgsql as
$$ begin if ok is not true then raise exception 'FAIL: %', name; end if; raise notice 'PASS: %', name; end; $$;
create or replace function public.t_expect_fail(stmt text, name text) returns void language plpgsql as
$$ begin
  begin execute stmt; exception when others then raise notice 'PASS: % (blocked: %)', name, sqlerrm; return; end;
  raise exception 'FAIL: % (expected an error, got none)', name;
end; $$;
grant execute on function public.t_assert(boolean, text), public.t_expect_fail(text, text) to anon, authenticated;

-- ===== T1 legacy data preserved by the migration =====
:as_su
select public.t_assert(
  (select notes = 'legacy note' and last_called_at = '2026-09-01T12:00:00Z' and reminder_date = '2026-09-20'
          and callback_at is null and contact_override_name is null and status = 'interested'
   from public.leads where dot_number = 1000001 and user_id = :'a1'),
  'T1 existing lead row unchanged; new columns are null (date-only reminder stays date-only)');

-- ===== T2 two agents save the same DOT independently =====
:as_a1
insert into public.leads (dot_number, user_id, organization_id, notes) values (1000002, :'a1', 'a0000000-0000-0000-0000-00000000000a', 'A1 private note');
:as_a2
insert into public.leads (dot_number, user_id, organization_id, notes) values (1000002, :'a2', 'a0000000-0000-0000-0000-00000000000a', 'A2 private note');
select public.t_assert((select count(*) = 1 and min(notes) = 'A2 private note' from public.leads where dot_number = 1000002),
  'T2 both agents hold their own lead for the same DOT; A2 sees only A2''s note');
:as_a1
select public.t_assert((select count(*) = 1 and min(notes) = 'A1 private note' from public.leads where dot_number = 1000002),
  'T2 A1 sees only A1''s note for the same DOT');

-- ===== T3 an agent cannot read, change, or delete another agent''s data =====
select public.t_assert((select count(*) = 0 from public.leads where user_id = :'a2'), 'T3 A1 cannot read A2 leads');
with u as (update public.leads set notes = 'hacked' where user_id = :'a2' returning 1)
select public.t_assert((select count(*) = 0 from u), 'T3 A1 cannot update A2 lead');
with d as (delete from public.leads where user_id = :'a2' returning 1)
select public.t_assert((select count(*) = 0 from d), 'T3 A1 cannot delete A2 lead');
select public.t_assert((public.search_leads(p_user_id => :'a2') ->> 'total')::int = 0, 'T3 search_leads for another agent returns nothing (RLS)');
select public.t_expect_fail($$insert into public.leads (dot_number, user_id, organization_id) values (1000003, '22222222-2222-2222-2222-222222222222', 'a0000000-0000-0000-0000-00000000000a')$$,
  'T3 A1 cannot insert a lead owned by A2');
select public.t_expect_fail($$insert into public.leads (dot_number, user_id, organization_id) values (1000003, '11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-00000000000b')$$,
  'T3 A1 cannot insert a lead into another organization');

-- ===== T4 same-organization admin viewing is preserved; cross-organization is not possible =====
:as_admA
select public.t_assert((select count(*) >= 1 from public.leads where user_id = :'a1'), 'T4 same-org admin can still view an agent''s leads (existing behavior preserved)');
:as_admB
select public.t_assert((select count(*) = 0 from public.leads where user_id in (:'a1', :'a2')), 'T4 other-organization admin sees none of org A leads');
select public.t_assert((public.search_leads(p_user_id => :'a1') ->> 'total')::int = 0, 'T4 other-organization admin cannot search org A agent leads');

-- ===== T5 identity cannot be moved by an update =====
:as_a1
select public.t_expect_fail($$update public.leads set organization_id = 'b0000000-0000-0000-0000-00000000000b' where user_id = '11111111-1111-1111-1111-111111111111'$$, 'T5 lead cannot be moved to another organization');
select public.t_expect_fail($$update public.leads set user_id = '22222222-2222-2222-2222-222222222222' where user_id = '11111111-1111-1111-1111-111111111111'$$, 'T5 lead cannot be reassigned to another agent');
select public.t_expect_fail($$update public.leads set notes = repeat('x', 5001) where dot_number = 1000002 and user_id = '11111111-1111-1111-1111-111111111111'$$, 'T5 notes over 5000 characters rejected');

-- ===== T6 history cannot be written or edited directly =====
select public.t_expect_fail($$insert into public.lead_events (organization_id, user_id, dot_number, event_type) values ('a0000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111',1000002,'call_logged')$$, 'T6 no direct history insert');
select public.t_expect_fail($$update public.lead_events set note = 'x'$$, 'T6 no history update');
select public.t_expect_fail($$delete from public.lead_events$$, 'T6 no history delete');
:as_anon
select public.t_expect_fail($$select * from public.lead_events$$, 'T6 anonymous cannot read history');
select public.t_expect_fail($$select public.search_leads()$$, 'T6 anonymous cannot call search');
select public.t_expect_fail($$select public.log_lead_call(1000002, gen_random_uuid(), 'call_logged')$$, 'T6 anonymous cannot log calls');

-- ===== T7 status edit is NOT a call; call log is idempotent and counts once =====
:as_su
insert into public.shifts (user_id, organization_id) values (:'a1', 'a0000000-0000-0000-0000-00000000000a');
:as_a1
select public.set_lead_status(1000001, 'not_interested', gen_random_uuid());
select public.t_assert((select last_called_at = '2026-09-01T12:00:00Z' and status = 'not_interested' from public.leads where dot_number = 1000001 and user_id = :'a1'),
  'T7 editing status does not move last_called_at');
select public.t_assert((select count(*) = 0 from public.lead_events where event_type in ('call_logged','dial_initiated')), 'T7 status edit creates no call event');
select public.t_assert((select count(*) = 1 from public.lead_events where event_type = 'status_changed' and dot_number = 1000001), 'T7 status edit creates exactly one status_changed event');
select public.t_assert((select carriers_logged = 0 from public.shifts where user_id = :'a1'), 'T7 status edit does not count toward the shift');

\set key '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
select public.log_lead_call(1000002, :key::uuid, 'call_logged', 'interested', 'Spoke with owner, wants a rate sheet');
select public.log_lead_call(1000002, :key::uuid, 'call_logged', 'interested', 'Spoke with owner, wants a rate sheet');
select public.log_lead_call(1000002, :key::uuid, 'call_logged', 'interested', 'Spoke with owner, wants a rate sheet');
select public.t_assert((select count(*) = 1 from public.lead_events where event_type = 'call_logged' and dot_number = 1000002), 'T7 retried call-log request creates exactly one event');
select public.t_assert((select count(*) = 1 from public.lead_events where event_type = 'status_changed' and dot_number = 1000002), 'T7 retry does not duplicate the status event');
select public.t_assert((select carriers_logged = 1 from public.shifts where user_id = :'a1'), 'T7 retried call-log counts once toward the shift');
select public.t_assert((select status = 'interested' and last_called_at is not null and last_called_at > '2026-09-01' from public.leads where dot_number = 1000002 and user_id = :'a1'), 'T7 call log sets status and last_called_at');
select public.t_expect_fail($$select public.log_lead_call(1000002, null, 'call_logged')$$, 'T7 call log requires an idempotency key');
select public.t_expect_fail($$select public.log_lead_call(1000002, gen_random_uuid(), 'call_logged', 'made_up_status')$$, 'T7 call log rejects a status that the organization does not have');
select public.log_lead_call(1000002, gen_random_uuid(), 'dial_initiated');
select public.t_assert((select count(*) = 1 from public.lead_events where event_type = 'dial_initiated'), 'T7 dial attempt recorded as an attempt only');
select public.t_assert((select carriers_logged = 1 from public.shifts where user_id = :'a1'), 'T7 dial attempt does not count as a logged call');

-- ===== T8 history is personal =====
:as_a2
select public.t_assert((select count(*) = 0 from public.lead_events), 'T8 A2 sees none of A1''s history');
:as_admA
select public.t_assert((select count(*) >= 3 from public.lead_events where user_id = :'a1'), 'T8 same-org admin can view an agent''s history (preserved admin visibility)');
:as_admB
select public.t_assert((select count(*) = 0 from public.lead_events), 'T8 other-org admin sees no history');

-- ===== T9 Do Not Call =====
:as_a1
select public.set_lead_status(1000002, 'do_not_call', gen_random_uuid());
select public.t_expect_fail($$select public.log_lead_call(1000002, gen_random_uuid(), 'dial_initiated')$$, 'T9 dialing a Do Not Call lead is refused');
select public.t_expect_fail($$select public.set_lead_callback(1000002, gen_random_uuid(), now() + interval '1 day', 'America/New_York', null, 'x')$$, 'T9 callbacks are refused on a Do Not Call lead');
select public.t_assert((public.search_leads(p_dnc => true) ->> 'total')::int = 1, 'T9 dedicated Do Not Call filter returns the lead');
:as_a2
select public.t_assert((select count(*) = 0 from public.leads where user_id = :'a2' and status = 'do_not_call'), 'T9 suppression is personal: A2''s lead for the same DOT is not affected');

-- ===== T10 callbacks: timed, date-only, reschedule, complete, clear =====
:as_a1
select public.set_lead_callback(1000004, gen_random_uuid(), '2026-03-09T18:30:00Z', 'America/New_York', null, 'ask about fleet renewal');
select public.t_assert((select callback_timezone = 'America/New_York' and reminder_date = '2026-03-09' and callback_at = '2026-03-09T18:30:00Z' and not reminder_done from public.leads where dot_number = 1000004 and user_id = :'a1'),
  'T10 timed callback stored as an instant with explicit timezone and derived local date');
select public.set_lead_callback(1000004, gen_random_uuid(), '2026-03-10T18:30:00Z', 'America/New_York', null, 'moved');
select public.t_assert((select count(*) = 1 from public.lead_events where dot_number = 1000004 and event_type = 'callback_set')
                   and (select count(*) = 1 from public.lead_events where dot_number = 1000004 and event_type = 'callback_rescheduled'), 'T10 reschedule is recorded as a reschedule');
select public.complete_lead_callback(1000004, gen_random_uuid());
select public.t_assert((select reminder_done and reminder_completed_at is not null from public.leads where dot_number = 1000004 and user_id = :'a1'), 'T10 complete marks the callback done');
select public.set_lead_callback(1000005, gen_random_uuid(), null, null, '2027-06-01', 'date only');
select public.t_assert((select callback_at is null and callback_timezone is null and reminder_date = '2027-06-01' from public.leads where dot_number = 1000005 and user_id = :'a1'), 'T10 date-only callback stays date-only');
select public.clear_lead_callback(1000005, gen_random_uuid());
select public.t_assert((select reminder_date is null and callback_at is null and reminder_note is null from public.leads where dot_number = 1000005 and user_id = :'a1'), 'T10 clear removes the callback');
select public.t_expect_fail($$select public.set_lead_callback(1000005, gen_random_uuid(), now(), 'Not/AZone', null, null)$$, 'T10 invalid timezone rejected');
select public.t_expect_fail($$select public.set_lead_callback(1000005, gen_random_uuid(), null, null, null, null)$$, 'T10 must give a time or a date');
select public.t_expect_fail($$select public.set_lead_callback(1000005, gen_random_uuid(), now(), 'UTC', '2030-01-01', null)$$, 'T10 cannot give both a time and a date');
select public.t_expect_fail($$select public.set_lead_callback(1000005, gen_random_uuid(), null, null, '2035-01-01', null)$$, 'T10 callback more than 3 years out rejected');

-- ===== T11 buckets and counts come from the database, not from a loaded page =====
:as_su
delete from public.lead_events; delete from public.leads;
insert into public.leads (dot_number, user_id, organization_id, status, callback_at, callback_timezone, reminder_date, reminder_done)
select 1000100 + n, :'a1', 'a0000000-0000-0000-0000-00000000000a', 'callback', at_, tz, (at_ at time zone tz)::date, done
from (values
 (1, now() - interval '3 hours', 'America/New_York', false),            -- overdue (timed, earlier today or yesterday)
 (2, now() + interval '30 hours', 'America/New_York', false),           -- upcoming
 (3, now() - interval '1 day', 'America/Chicago', true)                 -- completed
) v(n, at_, tz, done);
insert into public.leads (dot_number, user_id, organization_id, status, reminder_date, reminder_done)
values (1000110, :'a1', 'a0000000-0000-0000-0000-00000000000a', 'callback', (now() at time zone 'America/Chicago')::date, false),            -- date-only today
       (1000111, :'a1', 'a0000000-0000-0000-0000-00000000000a', 'callback', (now() at time zone 'America/Chicago')::date - 2, false),      -- date-only overdue
       (1000112, :'a1', 'a0000000-0000-0000-0000-00000000000a', 'do_not_call', (now() at time zone 'America/Chicago')::date - 2, false);   -- DNC: never counted
:as_a1
select public.t_assert((public.lead_callback_counts('America/Chicago')) = jsonb_build_object('overdue', 2, 'today', 1, 'upcoming', 1, 'completed', 1, 'dnc', 1),
  'T11 callback counts (overdue/today/upcoming/completed + DNC) are computed over all personal leads; DNC excluded from callbacks');
select public.t_assert((public.search_leads(p_callback => 'overdue', p_tz => 'America/Chicago') ->> 'total')::int = 2, 'T11 overdue view');
select public.t_assert((public.search_leads(p_callback => 'completed', p_tz => 'America/Chicago') ->> 'total')::int = 1, 'T11 completed view');
select public.t_assert((public.search_leads(p_callback => 'today', p_tz => 'America/Chicago') ->> 'total')::int = 1, 'T11 today view');

-- ===== T12 confirmed contact override =====
:as_su
delete from public.lead_events; delete from public.leads;
:as_a1
select public.set_lead_contact(1000200, gen_random_uuid(), '  José Núñez-Öz Jr.  ', 'owner');
select public.t_assert((select contact_override_name = 'José Núñez-Öz Jr.' and contact_override_role = 'owner' and contact_confirmed_at is not null from public.leads where dot_number = 1000200 and user_id = :'a1'),
  'T12 override stored trimmed, with accents/punctuation intact, role and confirmation time');
:as_a2
select public.t_assert((select count(*) = 0 from public.leads where dot_number = 1000200), 'T12 another agent does not see or inherit the override');
select public.set_lead_status(1000200, 'interested', gen_random_uuid());
select public.t_assert((select contact_override_name is null from public.leads where dot_number = 1000200 and user_id = :'a2'), 'T12 other agent''s lead for the same DOT has no override');
select public.t_assert((select legal_name is not null from public.carriers where dot_number = 1000200) and (select not exists(select 1 from information_schema.columns where table_name='carriers' and column_name like 'contact_override%')), 'T12 the shared carrier record is untouched');
:as_a1
select public.t_expect_fail($$select public.set_lead_contact(1000200, gen_random_uuid(), 'X', 'boss')$$, 'T12 invalid role rejected');
select public.t_expect_fail($$select public.set_lead_contact(1000200, gen_random_uuid(), repeat('x',101), 'owner')$$, 'T12 over-long name rejected');
select public.t_expect_fail($$select public.set_lead_contact(1000200, gen_random_uuid(), '   ', 'owner')$$, 'T12 blank name rejected');
select public.clear_lead_contact(1000200, gen_random_uuid());
select public.t_assert((select contact_override_name is null and contact_override_role is null and contact_confirmed_at is null from public.leads where dot_number = 1000200 and user_id = :'a1'), 'T12 clearing restores the automatic display (all override fields empty)');
select public.t_assert((select count(*) = 2 from public.lead_events where dot_number = 1000200 and user_id = :'a1' and event_type in ('contact_confirmed','contact_cleared')), 'T12 confirm and clear are both in history');

-- ===== T13 search beyond the old 500-row limit, and pagination =====
:as_su
delete from public.lead_events; delete from public.leads;
-- 700 leads for A1, all inserted in ONE statement so they share the same updated_at (worst case for ordering ties)
insert into public.leads (dot_number, user_id, organization_id, status, priority, saved, notes)
select 1000000 + g, :'a1', 'a0000000-0000-0000-0000-00000000000a', 'new', g % 10 = 0, g % 25 = 0, 'n' || g from generate_series(1, 700) g;
-- an old-style limit of 500 recent rows would never have shown the lowest dot numbers
:as_a1
select public.t_assert((public.search_leads(p_q => 'Carrier 0003', p_limit => 25) ->> 'total')::int = 1, 'T13 search finds a lead that would sit beyond the old 500-row window (by name)');
select public.t_assert((public.search_leads(p_q => '1000003') -> 'rows' -> 0 ->> 'dot_number') = '1000003', 'T13 search by DOT');
select public.t_assert((public.search_leads(p_q => '500003') ->> 'total')::int >= 1, 'T13 search by MC number');
select public.t_assert((public.search_leads(p_q => '488-0003') ->> 'total')::int >= 1 and (public.search_leads(p_q => '7154880003') ->> 'total')::int >= 1, 'T13 search by phone (formatted or digits only)');
select public.t_assert((public.search_leads(p_q => 'dba nine 700') ->> 'total')::int = 1, 'T13 search by DBA');
select public.t_assert((public.search_leads(p_q => 'éxpress') ->> 'total')::int >= 1, 'T13 accented text is searchable');
select public.t_assert((public.search_leads(p_q => '%') ->> 'total')::int = 0, 'T13 a literal % is not a wildcard');
select public.t_assert((public.search_leads(p_q => $$'; drop table public.leads; --$$) ->> 'total')::int = 0, 'T13 injection-style text is just text');
select public.t_assert((select count(*) = 700 from public.leads), 'T13 leads table intact after hostile search text');
select public.t_assert((public.search_leads(p_important => true) ->> 'total')::int = 70 and (public.search_leads(p_saved => true) ->> 'total')::int = 28, 'T13 important/saved filters run server-side');
-- pagination: page through everything, no duplicates, no gaps, even though updated_at ties
create temp table t_pages (dot bigint, pg int);
do $$
declare pg int := 0; r jsonb;
begin
  loop
    r := public.search_leads(p_limit => 50, p_offset => pg * 50);
    exit when jsonb_array_length(r -> 'rows') = 0;
    insert into t_pages select (x ->> 'dot_number')::bigint, pg from jsonb_array_elements(r -> 'rows') x;
    pg := pg + 1;
  end loop;
end $$;
select public.t_assert((select count(*) = 700 and count(distinct dot) = 700 from t_pages), 'T13 pagination returns every lead exactly once (no duplicate, no skip)');
select public.t_assert((public.search_leads(p_limit => 50, p_offset => 0) -> 'rows' -> 0 ->> 'dot_number') = (public.search_leads(p_limit => 50, p_offset => 0) -> 'rows' -> 0 ->> 'dot_number'), 'T13 same query returns the same order again');
select public.t_expect_fail($$select public.search_leads(p_limit => 101)$$, 'T13 page size is bounded');
select public.t_expect_fail($$select public.search_leads(p_offset => -1)$$, 'T13 negative offset rejected');
select public.t_expect_fail($$select public.search_leads(p_sort => 'name; drop table leads')$$, 'T13 unknown sort rejected');

-- ===== T14 DST boundaries in the database bucket logic (America/New_York) =====
:as_su
delete from public.lead_events; delete from public.leads;
:as_a1
select public.set_lead_callback(1000300, gen_random_uuid(), '2026-11-01T05:30:00Z', 'America/New_York', null, 'first 1:30 (EDT)');
select public.set_lead_callback(1000301, gen_random_uuid(), '2026-11-01T06:30:00Z', 'America/New_York', null, 'second 1:30 (EST)');
select public.t_assert((select reminder_date = '2026-11-01' from public.leads where dot_number in (1000300, 1000301) group by reminder_date having count(*) = 2), 'T14 both instants of the repeated fall-back hour map to the same local date');
select public.t_assert((select count(distinct callback_at) = 2 from public.leads where dot_number in (1000300, 1000301)), 'T14 the two repeated-hour instants stay distinct');

select 'ALL SQL TESTS PASSED' as result;
