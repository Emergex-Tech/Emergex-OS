#!/bin/bash
# Executes every SQL file for real, then checks security (RLS as different users) and that the
# exact insert shapes the code uses are accepted by the schema.
#
#   docker run -d --name exos-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
#   PG_BASE_URL=postgresql://postgres:postgres@localhost:5432 supabase/tests/run.sh
#
# Set SKIP_EXTENSIONS=1 only on a Postgres without contrib (then pg_trgm's similarity() is stubbed).
set -e
BASE=${PG_BASE_URL:?set PG_BASE_URL to a THROWAWAY local Postgres, e.g. postgresql://postgres:postgres@localhost:5432}
case "$BASE" in *supabase*) echo "Refusing: that looks like a Supabase URL."; exit 1;; esac
HERE="$(cd "$(dirname "$0")" && pwd)"; DB=exos_test
psql "$BASE/postgres" -q -c "drop database if exists $DB" -c "create database $DB"
run() { psql "$BASE/$DB" -v ON_ERROR_STOP=1 -q "$@"; }
run -f "$HERE/harness_stub.sql"
[ -n "$SKIP_EXTENSIONS" ] && run -f "$HERE/harness_trgm_stub.sql"
cd "$HERE/.."
for f in schema.sql policies.sql functions.sql $(ls migrations/*.sql | sort); do
  if [ -n "$SKIP_EXTENSIONS" ]; then sed '/^create extension/d' "$f" | run -f -; else run -f "$f"; fi
  echo "ok  $f"
done
run -f "$HERE/security_and_shapes.sql"
run -f "$HERE/conflicts.sql"
run -f "$HERE/finance.sql"
run -f "$HERE/agent_access.sql"
run -f "$HERE/benchmarks.sql"
run -f "$HERE/projects.sql"
run -f "$HERE/proof_metrics.sql"
