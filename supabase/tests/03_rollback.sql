\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\set as_a1   'reset role; select set_config(''request.jwt.claim.sub'', ''11111111-1111-1111-1111-111111111111'', false); set role authenticated;'
\set as_su   'reset role; select set_config(''request.jwt.claim.sub'', '''', false);'

-- Data captured with the new features
:as_su
delete from public.lead_events; delete from public.leads;
:as_a1
select public.set_lead_contact(1000400, gen_random_uuid(), 'Rollback Test', 'owner');
select public.log_lead_call(1000400, gen_random_uuid(), 'call_logged', 'interested', 'kept after rollback');
select public.set_lead_callback(1000400, gen_random_uuid(), '2027-03-01T15:00:00Z', 'America/Chicago', null, 'cb');
:as_su
create temp table before_rb as select
  (select count(*) from public.lead_events) as events,
  (select contact_override_name from public.leads where dot_number = 1000400) as contact,
  (select callback_at from public.leads where dot_number = 1000400) as cb;
\echo '-- applying rollback'
\i /tmp/rollback_path.sql
select public.t_assert((select count(*) = 0 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('search_leads','log_lead_call','set_lead_status','set_lead_callback','set_lead_contact','lead_callback_counts')),
  'RB the new functions are gone');
select public.t_assert((select events = (select count(*) from public.lead_events) and contact = (select contact_override_name from public.leads where dot_number = 1000400) and cb = (select callback_at from public.leads where dot_number = 1000400) from before_rb),
  'RB every event, the confirmed contact and the timed callback captured earlier are still there');
-- the previously deployed app's own queries still work (it ignores the new columns/table)
:as_a1
insert into public.leads (dot_number, user_id, organization_id, status, notes, last_called_at) values (1000401, '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-00000000000a', 'interested', 'old app write', now())
  on conflict (dot_number, user_id) do update set notes = excluded.notes;
select public.t_assert((select notes = 'old app write' from public.leads where dot_number = 1000401), 'RB old-app style upsert still works');
select public.t_assert((select count(*) >= 1 from public.leads l join public.carriers c using (dot_number) where l.user_id = '11111111-1111-1111-1111-111111111111'), 'RB old-app style list query still works');
select public.t_assert((select count(*) >= 1 from public.lead_events), 'RB the owner can still read their history');
-- re-applying the migration brings everything back without touching data
:as_su
\echo '-- re-applying migration'
\i /tmp/migration_path.sql
select public.t_assert((select count(*) = 6 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('search_leads','log_lead_call','set_lead_status','set_lead_callback','set_lead_contact','lead_callback_counts')), 'RB re-applying the migration restores the functions');
select public.t_assert((select events = (select count(*) from public.lead_events) from before_rb), 'RB history unchanged after re-apply');
:as_a1
select public.t_assert((public.search_leads() ->> 'total')::int >= 2, 'RB features work again after re-apply');
select 'ROLLBACK TESTS PASSED' as result;
