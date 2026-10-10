#!/usr/bin/env bash
# Runs the migration + SQL tests on a throwaway local Postgres database. Never touches Supabase.
set -euo pipefail
DB=scratch_leads
HERE="$(cd "$(dirname "$0")" && pwd)"
MIG="$HERE/../migrations/20261009120000_personal_lead_management.sql"
PSQL="psql -X -v ON_ERROR_STOP=1 -q -d $DB"
su postgres -c "psql -X -q -c 'drop database if exists $DB'" 
su postgres -c "psql -X -q -c 'create database $DB'"
run() { su postgres -c "$PSQL -f $1"; }
run "$HERE/00_baseline_prod_subset.sql"
run "$HERE/01_seed.sql"
echo "--- applying migration (1st time)"; run "$MIG"
echo "--- applying migration again (must be idempotent)"; run "$MIG"
echo "--- running tests"
su postgres -c "psql -X -d $DB -v ON_ERROR_STOP=1 -f $HERE/02_tests.sql" 2>&1 | grep -E "PASS|FAIL|ERROR|ALL SQL|WARNING" || true
echo "--- rollback + re-apply"
cp "$HERE/../rollback/20261009120000_personal_lead_management_rollback.sql" /tmp/rollback_path.sql
cp "$MIG" /tmp/migration_path.sql
chmod a+r /tmp/rollback_path.sql /tmp/migration_path.sql
su postgres -c "psql -X -d $DB -v ON_ERROR_STOP=1 -f $HERE/03_rollback.sql" 2>&1 | grep -E "PASS|FAIL|ERROR|ROLLBACK TESTS" || true
