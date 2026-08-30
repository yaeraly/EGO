#!/usr/bin/env bash
#
# EGOMOT — Ubuntu орнотуу
#
# Node.js, PostgreSQL жана EGOMOT'ту бир машинага орнотот: базаны түзөт,
# ролдорду ажыратат, миграцияларды колдонот, биринчи OWNER'ди сеет кылат
# жана API менен web'ди курат.
#
# Кайра иштетүүгө болот: бар нерсени кайра түзбөйт.
#
# Колдонуу:
#   scripts/install-ubuntu.sh
#
# Ыңгайлаштыруу (алдын ала export кыл):
#   EGOMOT_DB           база аты            (демейки: egomot)
#   EGOMOT_DB_OWNER     схеманын ээси       (демейки: egomot_owner)
#   EGOMOT_DB_APP_USER  тиркеменин колдонуучусу (демейки: egomot_app_user)
#   EGOMOT_OWNER_PHONE  биринчи OWNER'дин телефону (демейки: 0700000000)
#   SKIP_APT=1          пакет орнотууну аттап өтүү

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${EGOMOT_DB:-egomot}"
DB_OWNER="${EGOMOT_DB_OWNER:-egomot_owner}"
DB_APP_USER="${EGOMOT_DB_APP_USER:-egomot_app_user}"
OWNER_PHONE="${EGOMOT_OWNER_PHONE:-0700000000}"
NODE_MAJOR=22

# root катары иштесе sudo керек эмес (Docker/LXC ичинде көп кездешет).
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[0;32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[0;33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[0;31mКАТА:\033[0m %s\n' "$*" >&2; exit 1; }

as_postgres() {
  if [ -n "$SUDO" ]; then
    $SUDO -u postgres psql -v ON_ERROR_STOP=1 "$@"
  else
    # printf %q — bash'тын цитата стили, ошондуктан кабыгы да bash болушу
    # керек: dash аны түшүнбөйт жана көп саптуу SQL бузулат.
    su postgres -s /bin/bash -c "psql -v ON_ERROR_STOP=1 $(printf '%q ' "$@")"
  fi
}

# Ар бир роль үчүн бир жолу түзүлгөн, .env ичинде гана сакталган пароль.
new_password() { head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 32; }

# --- 0. Алдын ала текшерүү -------------------------------------------------

say "Системаны текшерүү"
[ -f "$ROOT/db/egomot_schema.sql" ] || die "$ROOT EGOMOT репозиторийи эмес окшойт"
[ -n "$SUDO" ] && ! command -v sudo >/dev/null && die "sudo керек (же root катары иштет)"

grep -qi ubuntu /etc/os-release || warn "Ubuntu эмес — скрипт иштеши мүмкүн, бирок текшерилген эмес"
ok "Репозиторий: $ROOT"

# --- 1. Системалык пакеттер ------------------------------------------------

if [ "${SKIP_APT:-0}" = "1" ]; then
  say "Пакет орнотуу аттап өтүлдү (SKIP_APT=1)"
else
  say "Системалык пакеттер"
  $SUDO apt-get update -qq
  # build-essential/python3 — argon2'нин нативдик модулу үчүн.
  $SUDO apt-get install -y -qq \
    curl ca-certificates gnupg git build-essential python3 \
    postgresql postgresql-contrib
  ok "curl, git, build-essential, python3, postgresql"
fi

# --- 2. Node.js ------------------------------------------------------------

say "Node.js $NODE_MAJOR"
current_node=""
if command -v node >/dev/null; then
  current_node="$(node -v | sed 's/^v//' | cut -d. -f1)"
fi

if [ "$current_node" = "$NODE_MAJOR" ] || { [ -n "$current_node" ] && [ "$current_node" -gt "$NODE_MAJOR" ]; }; then
  ok "Node $(node -v) орнотулган"
elif [ "${SKIP_APT:-0}" = "1" ]; then
  die "Node $NODE_MAJOR+ керек, бирок SKIP_APT=1 коюлган"
else
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | $SUDO -E bash -
  $SUDO apt-get install -y -qq nodejs
  ok "Node $(node -v) орнотулду"
fi

# --- 3. PostgreSQL иштеп жатабы --------------------------------------------

say "PostgreSQL"
$SUDO systemctl enable --now postgresql >/dev/null 2>&1 \
  || $SUDO pg_ctlcluster "$(pg_lsclusters -h 2>/dev/null | awk 'NR==1{print $1}')" main start >/dev/null 2>&1 \
  || true
pg_isready -q || die "PostgreSQL иштебей жатат"
ok "$($SUDO -u postgres psql -tAc 'SHOW server_version' | tr -d ' ') иштеп жатат"

# --- 4. Ролдор жана база ----------------------------------------------------
#
# Эки роль атайын ажыратылган:
#
#   egomot_owner     — схеманын ээси. Миграцияларды иштетет. CREATEROLE керек,
#                      анткени 1-миграция egomot_app ролун түзөт.
#   egomot_app_user  — тиркеме иштеген роль. SUPERUSER ЭМЕС.
#
# Бул ажыратуу audit_log/security_log'дун append-only болушун камсыздайт:
# superuser бардык укук текшерүүсүн айланып өтөт, ошондуктан тиркеме
# superuser болсо, 1-миграциянын кепилдиги жөн эле кооздук болуп калмак.

say "База жана ролдор"

owner_exists=$(as_postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_OWNER'" || true)
if [ "$owner_exists" = "1" ]; then
  ok "Роль $DB_OWNER бар"
  OWNER_PASS=""
else
  OWNER_PASS="$(new_password)"
  as_postgres -c "CREATE ROLE $DB_OWNER LOGIN CREATEROLE PASSWORD '$OWNER_PASS';" >/dev/null
  ok "Роль $DB_OWNER түзүлдү (CREATEROLE, superuser эмес)"
fi

app_exists=$(as_postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_APP_USER'" || true)
if [ "$app_exists" = "1" ]; then
  ok "Роль $DB_APP_USER бар"
  APP_PASS=""
else
  APP_PASS="$(new_password)"
  as_postgres -c "CREATE ROLE $DB_APP_USER LOGIN PASSWORD '$APP_PASS';" >/dev/null
  ok "Роль $DB_APP_USER түзүлдү (superuser эмес)"
fi

db_exists=$(as_postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB'" || true)
if [ "$db_exists" = "1" ]; then
  ok "База $DB бар"
else
  as_postgres -c "CREATE DATABASE $DB OWNER $DB_OWNER;" >/dev/null
  ok "База $DB түзүлдү"
fi

# --- 5. .env ---------------------------------------------------------------

say "Конфигурация (.env)"
ENV_FILE="$ROOT/.env"

if [ -f "$ENV_FILE" ]; then
  ok ".env бар — өзгөртүлбөйт"
  warn "Жаңы пароль керек болсо .env'ди өчүрүп, скриптти кайра иштет"
else
  [ -n "$OWNER_PASS" ] || die ".env жок, бирок $DB_OWNER ролу мурдатан бар — паролун билбейм. Ролду өчүр же .env'ди колдо жаз."
  [ -n "$APP_PASS" ]   || die ".env жок, бирок $DB_APP_USER ролу мурдатан бар — паролун билбейм. Ролду өчүр же .env'ди колдо жаз."

  JWT_SECRET="$(new_password)$(new_password)"
  BOOTSTRAP_PASSWORD="$(new_password)"
  BOOTSTRAP_PIN="$(( RANDOM % 9000 + 1000 ))"

  umask 077
  cat > "$ENV_FILE" <<ENV
# EGOMOT — scripts/install-ubuntu.sh тарабынан түзүлдү
# Бул файлда сырлар бар. Git'ке кирбейт (.gitignore) жана бөлүшүлбөйт.

# --- Database ---
# Тиркеме ЧЕКТЕЛГЕН роль менен туташат: audit_log/security_log append-only
# бойдон калышы үчүн ал superuser болбошу керек.
DATABASE_URL=postgresql://$DB_APP_USER:$APP_PASS@localhost:5432/$DB?schema=public

# Миграциялар жана seed схеманын ээси менен иштейт.
MIGRATION_DATABASE_URL=postgresql://$DB_OWNER:$OWNER_PASS@localhost:5432/$DB?schema=public

# --- API ---
API_PORT=3000
NODE_ENV=production
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=12h

# --- Web ---
WEB_PORT=5173
VITE_API_URL=http://localhost:3000

# --- Биринчи OWNER (§2) ---
# Биринчи киргенден кийин паролду жана PIN'ди алмаштыр.
BOOTSTRAP_OWNER_NAME=Owner
BOOTSTRAP_OWNER_PHONE=$OWNER_PHONE
BOOTSTRAP_OWNER_PASSWORD=$BOOTSTRAP_PASSWORD
BOOTSTRAP_OWNER_PIN=$BOOTSTRAP_PIN
ENV
  ok ".env түзүлдү (паролдор кокус берилди)"
fi

set -a; . "$ENV_FILE"; set +a
MIGRATION_URL="${MIGRATION_DATABASE_URL:-$DATABASE_URL}"

# --- 6. npm ----------------------------------------------------------------

say "npm пакеттери"
cd "$ROOT"
# --include=dev атайын: .env ичинде NODE_ENV=production турат (иштетүү үчүн
# туура), ал эми ал npm'ге devDependencies'ти аттатып жиберет — nest CLI,
# TypeScript жана Prisma ошол жерде, аларсыз куруу мүмкүн эмес.
if [ -f package-lock.json ]; then
  npm ci --include=dev --no-audit --no-fund
else
  npm install --include=dev --no-audit --no-fund
fi
ok "орнотулду (devDependencies кошо — куруу үчүн керек)"

# --- 7. Схема --------------------------------------------------------------

say "Маалымат базасынын схемасы"
DATABASE_URL="$MIGRATION_URL" npx prisma migrate deploy \
  --schema apps/api/prisma/schema.prisma
DATABASE_URL="$MIGRATION_URL" npx prisma generate \
  --schema apps/api/prisma/schema.prisma >/dev/null
ok "миграциялар колдонулду, Prisma client түзүлдү"

# 1-миграция egomot_app ролун түзөт. Тиркеменин колдонуучусу ага мүчө
# болушу керек — укуктар ошол ролдо турат.
as_postgres -d "$DB" -c "GRANT egomot_app TO $DB_APP_USER;" >/dev/null
ok "$DB_APP_USER → egomot_app мүчөлүгү берилди"

# --- 8. Seed ---------------------------------------------------------------

say "Баштапкы маалымат"
( cd apps/api && DATABASE_URL="$MIGRATION_URL" npx prisma db seed )
ok "OWNER, эсептер, настройкалар"

# --- 9. Build --------------------------------------------------------------

say "Куруу"
npm run build --workspace @egomot/api
npm run build --workspace @egomot/web
ok "API жана web курулду"

# --- 10. Текшерүү ----------------------------------------------------------

say "Орнотууну текшерүү"

superuser=$(as_postgres -tAc "SELECT rolsuper FROM pg_roles WHERE rolname='$DB_APP_USER'")
[ "$superuser" = "f" ] || die "$DB_APP_USER — superuser. audit_log'дун append-only кепилдиги иштебейт."
ok "$DB_APP_USER superuser эмес"

grants=$(as_postgres -d "$DB" -tAc \
  "SELECT string_agg(privilege_type,',' ORDER BY privilege_type)
   FROM information_schema.table_privileges
   WHERE grantee='egomot_app' AND table_name='audit_log'")
[ "$grants" = "INSERT,SELECT" ] || die "audit_log укуктары күтүлгөндөй эмес: $grants"
ok "audit_log append-only (INSERT, SELECT гана)"

tables=$(as_postgres -d "$DB" -tAc \
  "SELECT count(*) FROM information_schema.tables
   WHERE table_schema='public' AND table_type='BASE TABLE'")
ok "$tables таблица"

say "Даяр"
cat <<DONE

  Иштетүү:

    cd $ROOT
    npm run dev:api      # API  → http://localhost:${API_PORT:-3000}/api
    npm run dev:web      # web  → http://localhost:${WEB_PORT:-5173}

  Биринчи кирүү (.env ичинде):

    телефон : ${BOOTSTRAP_OWNER_PHONE:-$OWNER_PHONE}
    пароль  : .env → BOOTSTRAP_OWNER_PASSWORD
    PIN     : .env → BOOTSTRAP_OWNER_PIN

  Биринчи киргенден кийин паролду жана PIN'ди алмаштыр.

  Systemd менен туруктуу иштетүү үчүн: docs/INSTALL.md

DONE
