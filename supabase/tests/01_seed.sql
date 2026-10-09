-- Two organizations; org A has an admin and two ordinary agents; org B has an agent and an admin.
insert into public.organizations (id, name) values
 ('a0000000-0000-0000-0000-00000000000a','Org A'), ('b0000000-0000-0000-0000-00000000000b','Org B');
insert into public.profiles (id, organization_id, role, full_name) values
 ('11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-00000000000a','rep','Agent A1'),
 ('22222222-2222-2222-2222-222222222222','a0000000-0000-0000-0000-00000000000a','rep','Agent A2'),
 ('33333333-3333-3333-3333-333333333333','a0000000-0000-0000-0000-00000000000a','admin','Admin A'),
 ('44444444-4444-4444-4444-444444444444','b0000000-0000-0000-0000-00000000000b','rep','Agent B1'),
 ('55555555-5555-5555-5555-555555555555','b0000000-0000-0000-0000-00000000000b','admin','Admin B');
insert into public.call_statuses (organization_id, value, label, sort_order, is_default)
select o, v, l, s, v = 'new' from (values ('a0000000-0000-0000-0000-00000000000a'::uuid), ('b0000000-0000-0000-0000-00000000000b'::uuid)) o(o),
 (values ('new','New',0),('called_no_answer','No Answer',1),('callback','Callback',2),('interested','Interested',3),('not_interested','Not Interested',4),('signed','Signed',5),('do_not_call','Do Not Call',6)) t(v,l,s);
-- 1,200 carriers so search/pagination can be tested well past the old 500-row limit.
insert into public.carriers (dot_number, docket_prefix, docket_number, legal_name, dba_name, phone, phy_city, phy_state, power_units, status_code)
select 1000000 + g, 'MC', 500000 + g, 'Carrier ' || lpad(g::text, 4, '0') || case when g % 50 = 0 then ' Éxpress & Sons' else '' end,
       case when g % 7 = 0 then 'Dba Nine ' || g end, '(715) 488-' || lpad((g % 10000)::text, 4, '0'), 'Saint Croix Falls', 'WI', 1 + g % 8, 'A'
from generate_series(1, 1200) g;
-- an existing legacy lead (pre-migration shape) for compatibility checks
insert into public.leads (dot_number, user_id, organization_id, status, notes, last_called_at, reminder_date, reminder_note)
values (1000001, '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-00000000000a', 'interested', 'legacy note', '2026-09-01T12:00:00Z', '2026-09-20', 'legacy reminder');
