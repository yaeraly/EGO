#!/usr/bin/env bash
#
# db/egomot_schema.sql is the source of truth (CLAUDE.md); the migrations are
# how it reaches a database. The two must therefore describe the same schema.
#
# This builds one database from the SQL and one from `prisma migrate deploy`,
# dumps both, and diffs them. A difference means a migration was added without
# updating the reference SQL, or the reverse.
#
# Usage: scripts/verify-schema-parity.sh [postgres-url-without-database]
#   default: postgresql://egomot:egomot_dev_password@localhost:5432

set -euo pipefail

BASE_URL="${1:-postgresql://egomot:egomot_dev_password@localhost:5432}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FROM_SQL="egomot_parity_sql_$$"
FROM_MIG="egomot_parity_mig_$$"
WORK="$(mktemp -d)"

cleanup() {
  psql "$BASE_URL/postgres" -q -c "DROP DATABASE IF EXISTS $FROM_SQL;" >/dev/null 2>&1 || true
  psql "$BASE_URL/postgres" -q -c "DROP DATABASE IF EXISTS $FROM_MIG;" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

psql "$BASE_URL/postgres" -q -c "CREATE DATABASE $FROM_SQL;"
psql "$BASE_URL/postgres" -q -c "CREATE DATABASE $FROM_MIG;"

psql "$BASE_URL/$FROM_SQL" -q -v ON_ERROR_STOP=1 -f "$ROOT/db/egomot_schema.sql"

DATABASE_URL="$BASE_URL/$FROM_MIG?schema=public" \
  npx prisma migrate deploy --schema "$ROOT/apps/api/prisma/schema.prisma" >/dev/null

# The \restrict marker pg_dump emits carries a per-run nonce, so it is stripped
# along with comments, blank lines and session settings.
dump() {
  pg_dump "$BASE_URL/$1" --schema-only --no-owner --no-privileges \
    -T _prisma_migrations \
    | grep -v '^--' | grep -v '^$' \
    | grep -v '^SET ' | grep -v 'SELECT pg_catalog' \
    | grep -v '^\\restrict' | grep -v '^\\unrestrict'
}

dump "$FROM_SQL" > "$WORK/from_sql.sql"
dump "$FROM_MIG" > "$WORK/from_migrations.sql"

if diff -u "$WORK/from_sql.sql" "$WORK/from_migrations.sql"; then
  echo "OK: db/egomot_schema.sql and the migrations describe the same schema."
else
  echo ""
  echo "MISMATCH: the reference SQL and the migrations have diverged."
  echo "Left  = db/egomot_schema.sql"
  echo "Right = prisma migrate deploy"
  exit 1
fi
