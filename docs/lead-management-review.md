# Personal lead management: review guide

Branch: `feature/personal-lead-management` (not merged, not deployed to production, no production database changes applied).

## What changed, in the order of the request

| Stage | Change |
|---|---|
| 1. Reliable saving | New per-lead save engine (`lib/leadSaver.ts`, `lib/useLeadSaver.ts`). Every draft and request carries the lead (DOT) and the signed-in agent; responses are applied only to that lead; saves per lead go one at a time in order; failures keep the draft and show Retry; real states Unsaved / Saving / Saved / Save failed; explicit Save button; unsaved drafts also kept in local storage (per user, 7 days, cleared at logout); notes are flushed when moving to another carrier and before logout. `POST /api/leads` is a strict partial update (types validated, 5,000-character note limit now rejected instead of silently cut, null/empty handled on purpose). Status / important / saved edits are queued per lead and show errors with Retry. `LeadsList` checks `response.ok` everywhere. |
| 2. Schema and privacy | One additive migration (below). RLS on the new table, history written only by database functions, lead identity (dot, agent, organization) can no longer be changed by an update. |
| 3. Callbacks and confirmed contact | Timed callbacks stored as an exact instant plus an IANA timezone; old date-only reminders stay date-only until edited. Complete / reschedule / clear. Daylight-saving gaps and repeated hours handled and explained to the agent. Confirmed contact (name, role, time) lives on the agent's own lead; provider names are untouched; clearing restores the automatic display. |
| 4. History and call accuracy | Append-only `lead_events`. "Dial started" is recorded when Dial is pressed (it proves nothing about connection or duration). Explicit "Log call" with outcome and note. Changing a status no longer sets `last_called_at` or counts toward the shift. |
| 5. Do Not Call | Stored value is `do_not_call` (verified in both organizations; the label is configurable). Personal to the agent. Dial buttons are disabled and the server re-checks at the moment of dialing; callbacks are refused and hidden; next-carrier skips these leads (one batched lookup per batch) and continues from the right cursor, with an honest "keep scanning" message if a whole stretch is suppressed. A failed lookup stops the request instead of treating the lead as unrestricted. |
| 6. Search, pagination, exports | `GET /api/leads` now filters and searches in the database before paging (name, DBA, DOT, MC, phone; status, important, saved, callback view, Do Not Call), page size 1 to 100, stable order with a tie-breaker, stale responses ignored, separate loading / empty / error states. Counts come from the database. Exports read every page (no 1,000-row cut-off), neutralize spreadsheet formulas, add a UTF-8 marker, and include the new columns after the existing ones. |

Counter semantics changed: `shifts.carriers_logged` now counts explicit "Log call" actions, once each (idempotent). It used to increase on every status click. `last_called_at` now moves only on a dial attempt or a logged call. About 140 existing leads have a `last_called_at` that came from status changes; it is kept and shown as "Earlier activity (before call logging existed)", never turned into history.

Not changed on purpose: FMCSA field mapping, provider choice, enrichment, greeting logic (only the confirmed-contact name is used when one exists), scan strategy (one live batch, first usable carrier), Back/restoration (restoration now also carries all lead fields and fails closed), attendance, admin pages.

## Database

Migration: `supabase/migrations/20261009120000_personal_lead_management.sql` (additive and idempotent; no existing column, row, policy or function is changed or dropped).
Rollback: `supabase/rollback/20261009120000_personal_lead_management_rollback.sql` (turns features off, keeps all captured data; the destructive cleanup is commented out).

Facts verified against the live schema (read-only): `leads` primary key is `(dot_number, user_id)`, so two agents can already hold the same DOT independently; status is a foreign key `(organization_id, status)` to `call_statuses`; RLS is on for leads, carriers, shifts; the existing leads UPDATE policy has no WITH CHECK (the new trigger closes that); 144 leads, longest note under 2,000 characters; no duplicate (dot, user) rows are possible.

### Deployment order (safe because the migration is backward compatible)
1. Apply the migration (Supabase SQL editor or `supabase db push`). The currently deployed app keeps working.
2. Deploy / promote the branch.
3. If anything is wrong: redeploy `main`, and optionally run the rollback script. Nothing is lost.

If the app is deployed before the migration, notes, status, priority, saved and the lead list still work (basic mode, flagged on screen); callbacks, history, Log call, confirmed contact and Do Not Call filtering show "Not available yet: a database update still needs to be applied."

## Tests actually run (all on the build machine)
- `npm test`: 44 unit tests (save engine incl. late responses, out-of-order edits, failure + retry, draft scoping and expiry; DST gaps and repeated hours; callback buckets; CSV safety and paging; Do Not Call scanning and cursor; greeting regression).
- `npm run test:db`: applies the migration twice to a scratch Postgres built from the inspected production structure, then 87 assertions: two agents on the same DOT, cross-agent and cross-organization isolation, same-organization admin viewing preserved, history cannot be written or edited directly, retried call-log creates one event and counts once, status edit is not a call, Do Not Call blocks dialing and callbacks, callback buckets/counts, confirmed contact (accents, trimming, limits, isolation), search beyond 500 leads, hostile search text, pagination without duplicates or gaps while timestamps tie, rollback and re-apply with data intact.
- `npm run build` (includes TypeScript). `npm run lint`: see below.

Lint: the old `next lint` script no longer exists in Next.js 16, so `npm run lint` failed immediately. It now runs ESLint directly (devDependencies `eslint@9`, `eslint-config-next`, plus `eslint.config.mjs`). Three React-compiler-style rules are set to warnings because they flag a pattern already used across the app. Result: 0 errors in files added or changed here; 9 errors remain in files not touched (apostrophes in text in `TrialDial`, `AdminPanel`, `AccountSettings`, `SuperAdminPanel`); 26 warnings.

## Database-side timings (scratch Postgres, 60 runs each, excludes network, Vercel and FMCSA)

| | 144 leads (production-like) median / p95 | 20,000 leads median / p95 |
|---|---|---|
| Old list query (500 newest) | 1.0 / 1.8 ms | 1.6 / 2.8 ms |
| New first page (25 rows + total) | 1.7 / 2.4 ms | 9.2 / 11.6 ms |
| New text search | 3.2 / 4.3 ms | 162 / 189 ms |
| New status filter | 3.4 / 3.8 ms | 3.7 / 4.0 ms |
| Old partial notes save | 0.15 / 0.29 ms | 0.13 / 0.23 ms |
| New status save (status + event) | 0.09 / 0.25 ms | 0.08 / 0.14 ms |
| New call log (event + lead + shift) | 0.35 / 0.66 ms | 0.26 / 0.57 ms |

Notes: the old list could not search beyond its 500 rows, so the new search is doing more work by design. A first version was 8 to 25 times slower (slow timezone lookup, per-row work before paging); it was fixed before this table. Text search at 20,000 leads is a scan; add a trigram index if agents ever reach that size. The next-carrier request does not get an extra round trip: the lead lookup now runs together with the cache write and replaces the separate single-lead query. I could not measure the live app (network, Vercel, FMCSA upstream) from the build machine, so there is no end-to-end before/after number. To measure it yourself, in the browser console on the Dial page run `await Promise.all([1,2,3,4,5].map(async()=>{const t=performance.now();await fetch('/api/leads?limit=25');return performance.now()-t}))` before and after, and compare the `Server-Timing` / Vercel function duration for `/api/next-carrier` (upstream FMCSA time is the part that dominates it).

## Not verified (be aware)
- No browser or end-to-end run of the screens; layout and interactions are checked only by build, types and unit tests.
- Nothing was tested against the production database or with real Supabase logins; RLS and functions were tested on a scratch database that reproduces the inspected structure (policies, helper functions, constraints). Grants on production were read, not changed.
- The Vercel preview environment (variables for Preview) was not checked.
- Browser tel: handling after the server check was not tested on real phones.
- AI helper prompts do not yet use the confirmed contact name.
- Exports honor the simple filters (status, important, saved, Do Not Call, date range); the text-search and callback-view filters are not applied to exports.

## Reviewing the preview
1. Apply the migration to a staging Supabase project (or production, since it is additive), then open the preview URL.
2. Dial: type notes, press Next immediately, come Back: notes are still there and the state reads Saved. Turn off the network, type, watch "Save failed" and Retry.
3. Press Dial on a carrier: a "Dial started" line appears under History; status clicks never add one.
4. Mark a lead Do Not Call: Dial turns into "Do Not Call", callbacks disappear, Next skips it.
5. Set a callback for 1:30 AM on 2026-11-01 in Eastern time: you are told the hour repeats and the first one is used.
6. Leads page: search an old lead, use the Overdue / Today / Upcoming tabs, export, open the CSV in Excel.
