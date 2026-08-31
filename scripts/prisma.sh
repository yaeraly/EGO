#!/usr/bin/env bash
#
# Runs the Prisma CLI with the right schema and the right database URL, from
# any working directory.
#
# Two details this exists for:
#
#   * `.env` lives at the repository root, and the Prisma CLI only reads the
#     `.env` next to the current directory — so running from `apps/api` (which
#     is what npm workspaces do) leaves DATABASE_URL empty.
#   * migrations need the owner role (`MIGRATION_DATABASE_URL`), not the
#     restricted application role that `DATABASE_URL` names in a proper
#     install (docs/INSTALL.md §3). A single-role development machine has no
#     MIGRATION_DATABASE_URL, and then DATABASE_URL is the answer.
#
# Usage: scripts/prisma.sh migrate deploy
#        scripts/prisma.sh generate
#        scripts/prisma.sh seed          # `prisma db seed`, which needs apps/api

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCHEMA="$ROOT/apps/api/prisma/schema.prisma"

# Prints the value or nothing; never fails, so `set -e` does not end the run
# just because a machine has no MIGRATION_DATABASE_URL.
from_env_file() {
  [ -f "$ROOT/.env" ] || return 0
  grep -E "^$1=" "$ROOT/.env" | head -1 | cut -d= -f2- || true
}

URL="${MIGRATION_DATABASE_URL:-$(from_env_file MIGRATION_DATABASE_URL)}"
URL="${URL:-${DATABASE_URL:-$(from_env_file DATABASE_URL)}}"

if [ -z "$URL" ]; then
  echo "DATABASE_URL табылган жок." >&2
  echo "  $ROOT/.env файлын түзүңүз:  cp .env.example .env" >&2
  exit 1
fi

if [ "${1:-}" = "seed" ]; then
  # `prisma db seed` reads its command from apps/api/package.json#prisma, so it
  # has to run there; the seed itself finds the root .env for BOOTSTRAP_*.
  cd "$ROOT/apps/api"
  exec env DATABASE_URL="$URL" npx prisma db seed
fi

exec env DATABASE_URL="$URL" npx prisma "$@" --schema "$SCHEMA"
