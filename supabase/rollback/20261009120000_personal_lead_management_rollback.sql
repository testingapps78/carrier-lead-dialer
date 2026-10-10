-- SAFE ROLLBACK for 20261009120000_personal_lead_management.sql
--
-- What it does: turns the new features OFF (drops the new functions) and leaves EVERY piece of data
-- captured since the migration in place: the new leads columns and the whole lead_events table.
-- The previously deployed app (main) never reads the new columns/table, so it keeps working.
-- The new app, if still deployed, shows "needs a database update" for the affected features.
--
-- To bring the features back later, simply re-run the migration (it is idempotent; data is untouched).

drop function if exists public.search_leads(text, text, boolean, boolean, text, boolean, text, integer, integer, text, uuid);
drop function if exists public.lead_callback_counts(text, uuid);
drop function if exists public.set_lead_status(bigint, text, uuid);
drop function if exists public.log_lead_call(bigint, uuid, text, text, text);
drop function if exists public.set_lead_callback(bigint, uuid, timestamptz, text, date, text);
drop function if exists public.complete_lead_callback(bigint, uuid);
drop function if exists public.clear_lead_callback(bigint, uuid);
drop function if exists public.set_lead_contact(bigint, uuid, text, text);
drop function if exists public.clear_lead_contact(bigint, uuid);
drop function if exists public.lead_callback_bucket(text, timestamptz, date, boolean, text);
drop function if exists public._valid_tz(text);
drop function if exists public._ensure_lead(bigint, uuid, uuid);
drop function if exists public._lead_actor();

-- Kept on purpose (harmless to the old app, and protective):
--   * trg_leads_protect_identity: a lead can never be moved to another agent/organization.
--   * the new leads columns and public.lead_events with their data and RLS.

-- ---------------------------------------------------------------------------
-- OPTIONAL, DESTRUCTIVE, only after exporting what you want to keep:
--   -- copy the history and the new personal fields somewhere safe first, e.g.
--   --   \copy (select * from public.lead_events) to 'lead_events_backup.csv' csv header
--   -- drop trigger if exists trg_leads_protect_identity on public.leads;
--   -- drop function if exists public.leads_protect_identity();
--   -- drop table public.lead_events;
--   -- alter table public.leads drop column contact_override_name, drop column contact_override_role,
--   --   drop column contact_confirmed_at, drop column callback_at, drop column callback_timezone,
--   --   drop column reminder_completed_at;
-- ---------------------------------------------------------------------------
