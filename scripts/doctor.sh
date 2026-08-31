#!/usr/bin/env bash
#
# Checks a working copy after `git pull` and says what to run next.
#
# The failure that prompted this: a merge conflict left in the generated
# `schema.prisma` stopped `prisma generate`, so `@prisma/client` was never
# written, so `nest build` printed 755 unrelated type errors. The first line of
# that wall of output is the only one that matters, and it scrolls away. This
# reports the causes instead of the consequences.
#
# Usage: npm run doctor

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROBLEMS=0
say()  { printf '  %s\n' "$1"; }
ok()   { printf '\033[32mOK\033[0m   %s\n' "$1"; }
bad()  { printf '\033[31mКАТА\033[0m %s\n' "$1"; PROBLEMS=$((PROBLEMS + 1)); }
warn() { printf '\033[33mЭСКЕР\033[0m %s\n' "$1"; }

echo "EGOMOT doctor — $ROOT"
echo ""

# 1. Merge conflicts. schema.prisma is generated (db/README.md), so its
#    conflict is discarded rather than merged by hand.
CONFLICTED="$(git diff --name-only --diff-filter=U 2>/dev/null)"
MARKED="$(git grep -l -E '^(<{7}|={7}|>{7}) ?' -- '*.ts' '*.tsx' '*.sql' '*.prisma' '*.json' 2>/dev/null)"
if [ -n "$CONFLICTED$MARKED" ]; then
  bad "Чечилбеген merge конфликт бар:"
  printf '%s\n%s\n' "$CONFLICTED" "$MARKED" | sort -u | sed '/^$/d' | sed 's/^/       /'
  if printf '%s\n%s' "$CONFLICTED" "$MARKED" | grep -q 'apps/api/prisma/schema.prisma'; then
    say ""
    say "schema.prisma — генерацияланган файл (db/README.md), кол менен оңдолбойт:"
    say "    git checkout -- apps/api/prisma/schema.prisma"
  fi
else
  ok "Merge конфликт жок."
fi

# 2. The environment file, found the same way the API finds it.
if [ ! -f .env ]; then
  bad ".env жок. Көчүрүп алыңыз:  cp .env.example .env"
else
  MISSING=""
  for key in DATABASE_URL JWT_SECRET BOOTSTRAP_OWNER_PHONE BOOTSTRAP_OWNER_PASSWORD BOOTSTRAP_OWNER_PIN; do
    grep -qE "^${key}=.+" .env || MISSING="$MISSING $key"
  done
  if [ -n "$MISSING" ]; then
    bad ".env толук эмес, жетишпейт:$MISSING"
    say ".env.example ичинен ошол саптарды көчүрүңүз."
  else
    ok ".env бар жана толук."
  fi
fi

# 3. Dependencies and the generated client.
if [ ! -d node_modules ]; then
  bad "node_modules жок:  npm install"
elif [ ! -f node_modules/.prisma/client/index.d.ts ]; then
  bad "Prisma client генерацияланган эмес:  npm run db:generate"
else
  ok "Көз карандылыктар жана Prisma client ордунда."
fi

# 4. The database itself, using the same URL the application will use.
DB_URL="${DATABASE_URL:-$(grep -E '^DATABASE_URL=' .env 2>/dev/null | head -1 | cut -d= -f2-)}"
# psql rejects Prisma's `?schema=public`, so the query string is dropped here.
DB_URL="${DB_URL%%\?*}"
if [ -z "$DB_URL" ]; then
  warn "DATABASE_URL табылган жок — база текшерилген жок."
elif ! command -v psql >/dev/null 2>&1; then
  warn "psql жок — база текшерилген жок (docker compose up -d db иштеп жатабы?)."
elif ! psql "$DB_URL" -tAc 'select 1' >/dev/null 2>&1; then
  bad "Базага туташуу жок: $DB_URL"
  say "docker compose up -d db  — же PostgreSQL кызматын күйгүзүңүз."
else
  APPLIED="$(psql "$DB_URL" -tAc "select count(*) from _prisma_migrations where finished_at is not null" 2>/dev/null | tr -d ' ')"
  ON_DISK="$(find apps/api/prisma/migrations -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
  if [ -z "$APPLIED" ]; then
    # No _prisma_migrations table at all, or no rights to read it — either way
    # this check cannot answer, and guessing "0 applied" would be a false alarm.
    warn "Миграциялардын абалы окулган жок. Текшериңиз:  npm run db:deploy"
  elif [ "$APPLIED" -lt "$ON_DISK" ]; then
    bad "Миграция колдонулган эмес ($APPLIED / $ON_DISK):  npm run db:deploy"
  else
    ok "База ордунда, миграциялар толук ($APPLIED / $ON_DISK)."
  fi
fi

echo ""
if [ "$PROBLEMS" -eq 0 ]; then
  echo "Баары жайында. Иштетүү:  npm run dev:api  жана  npm run dev:web"
else
  echo "$PROBLEMS маселе табылды. Оңдогондон кийин:  npm run setup"
  exit 1
fi
