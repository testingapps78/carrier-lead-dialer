-- DATABASE-SIDE timings only (scratch Postgres on the build machine; excludes network, Vercel and FMCSA).
-- Compares the old list query shape with the new functions at a production-like size and a stress size.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
reset role;
create or replace function public.bench(label text, stmt text, n int default 60) returns void language plpgsql as $$
declare t0 timestamptz; ms double precision[] := '{}'; i int; r record; med double precision; p95 double precision; mx double precision;
begin
  for i in 1..n loop
    t0 := clock_timestamp(); execute stmt; ms := ms || (extract(epoch from clock_timestamp() - t0) * 1000);
  end loop;
  select percentile_cont(0.5) within group (order by x), percentile_cont(0.95) within group (order by x), max(x) into med, p95, mx from unnest(ms) x;
  raise notice 'BENCH % | n=% | median=% ms | p95=% ms | max=% ms', rpad(label, 46), n, round(med::numeric, 2), round(p95::numeric, 2), round(mx::numeric, 2);
end $$;
grant execute on function public.bench(text, text, int) to authenticated;

-- size 1: production-like (144 leads), size 2: stress (20,000 leads)
do $$
declare sz int;
begin
  foreach sz in array array[144, 20000] loop
    delete from public.lead_events; delete from public.leads;
    insert into public.carriers (dot_number, docket_prefix, docket_number, legal_name, dba_name, phone, phy_city, phy_state, power_units, status_code)
      select 3000000 + g, 'MC', 700000 + g, 'Perf Carrier ' || g, null, '(715) 555-' || lpad((g % 10000)::text, 4, '0'), 'Town', 'WI', 1 + g % 8, 'A'
      from generate_series(1, 20000) g on conflict do nothing;
    insert into public.leads (dot_number, user_id, organization_id, status, notes, priority, last_called_at)
      select 3000000 + g, '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-00000000000a',
             (array['new','interested','callback','not_interested'])[1 + g % 4], 'note ' || g, g % 9 = 0, now() - (g || ' minutes')::interval
      from generate_series(1, sz) g;
    analyze public.leads; analyze public.carriers;
    reset role;
    perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
    set role authenticated;
    raise notice '=== % leads for the agent ===', sz;
    perform public.bench('OLD list (join, 500 newest)', $q$ select l.*, c.legal_name, c.dba_name, c.phone from public.leads l left join public.carriers c on c.dot_number = l.dot_number where l.user_id = '11111111-1111-1111-1111-111111111111' order by l.updated_at desc, l.dot_number desc limit 500 $q$);
    perform public.bench('NEW search_leads page 1 (25 rows + total)', $q$ select public.search_leads() $q$);
    perform public.bench('NEW search_leads text search "Carrier 1234"', $q$ select public.search_leads(p_q => 'Carrier 1234') $q$);
    perform public.bench('NEW search_leads phone digits', $q$ select public.search_leads(p_q => '5550123') $q$);
    perform public.bench('NEW search_leads status filter', $q$ select public.search_leads(p_status => 'interested') $q$);
    perform public.bench('NEW lead_callback_counts', $q$ select public.lead_callback_counts('America/Chicago') $q$);
    perform public.bench('OLD save: upsert notes (partial)', format($q$ insert into public.leads (dot_number, user_id, organization_id, notes) values (%s, '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-00000000000a', 'x') on conflict (dot_number, user_id) do update set notes = excluded.notes $q$, 3000001));
    perform public.bench('NEW save: set_lead_status RPC (status + event)', $q$ select public.set_lead_status(3000002, 'interested', gen_random_uuid()) $q$);
    perform public.bench('NEW save: log_lead_call RPC (event + lead + shift)', $q$ select public.log_lead_call(3000003, gen_random_uuid(), 'call_logged', 'interested', 'n') $q$);
    reset role;
  end loop;
end $$;
