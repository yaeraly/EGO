# EGOMOT — Ubuntu'га орнотуу

Ubuntu 22.04 жана 24.04'те текшерилген. PostgreSQL 15+ жана Node.js 22 керек.

---

## 1. Тез жол — орнотуу скрипти

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/yaeraly/EGO.git egomot
cd egomot
./scripts/install-ubuntu.sh
```

Скрипт төмөнкүнү жасайт:

1. Node.js 22, PostgreSQL, `build-essential` жана `python3` орнотот
   (акыркы экөө `argon2`'нин нативдик модулу үчүн).
2. Эки база ролун түзөт — эмнеге экөө экени 3-бөлүмдө.
3. Базаны түзүп, миграцияларды колдонот.
4. Кокус паролдор менен `.env` жазат.
5. Биринчи OWNER'ди, эсептерди жана настройкаларды сеет кылат.
6. API менен web'ди курат.
7. Орнотууну текшерет — тиркеменин ролу superuser эмес экенин жана
   `audit_log` append-only бойдон калганын.

Скриптти кайра иштетүүгө болот: бар базаны, ролдорду же `.env`'ди кайра
түзбөйт.

### Ыңгайлаштыруу

```bash
EGOMOT_DB=egomot \
EGOMOT_DB_OWNER=egomot_owner \
EGOMOT_DB_APP_USER=egomot_app_user \
EGOMOT_OWNER_PHONE=0700123456 \
  ./scripts/install-ubuntu.sh

SKIP_APT=1 ./scripts/install-ubuntu.sh   # пакеттер мурдатан орнотулган болсо
```

### Иштетүү

```bash
npm run dev:api    # API → http://localhost:3000/api
npm run dev:web    # web → http://localhost:5173
```

Биринчи кирүү маалыматы `.env` ичинде: `BOOTSTRAP_OWNER_PHONE`,
`BOOTSTRAP_OWNER_PASSWORD`, `BOOTSTRAP_OWNER_PIN`.
**Биринчи киргенден кийин паролду жана PIN'ди алмаштыр.**

---

## 2. Docker жолу

Docker менен PostgreSQL'ди өзүң орнотуунун кереги жок:

```bash
git clone https://github.com/yaeraly/EGO.git egomot
cd egomot
cp .env.example .env
# .env ичинде JWT_SECRET менен BOOTSTRAP_OWNER_* маанилерин алмаштыр
docker compose up -d
```

Схема `db/egomot_schema.sql` аркылуу postgres томуна биринчи жүктөөдө
колдонулат. Андан кийин seed'ди бир жолу иштет:

```bash
docker compose exec api npx prisma db seed
```

> **Эскертүү.** `docker-compose.yml` иштеп чыгуу үчүн: API базага бир эле
> колдонуучу менен туташат. Продакшнда 3-бөлүмдөгү ролдорду ажыратуу керек.

---

## 3. Эмне үчүн эки база ролу

`audit_log` менен `security_log` append-only — бул тиркеменин адеби эмес,
базанын укугу (миграция `1_append_only_logs`). Ошондуктан:

| Роль | Эмне кылат | Укугу |
|---|---|---|
| `egomot_owner` | миграциялар, seed | схеманын ээси, `CREATEROLE` |
| `egomot_app_user` | **иштеп жаткан тиркеме** | `egomot_app` мүчөсү, **superuser ЭМЕС** |

**Тиркеменин колдонуучусу superuser болбошу керек.** Superuser бардык укук
текшерүүсүн айланып өтөт, ошондо append-only кепилдиги жөн эле кооздук болуп
калат.

`.env` ичинде экөө өзүнчө:

```
DATABASE_URL=postgresql://egomot_app_user:...@localhost:5432/egomot?schema=public
MIGRATION_DATABASE_URL=postgresql://egomot_owner:...@localhost:5432/egomot?schema=public
```

Текшерүү:

```bash
sudo -u postgres psql -tAc "SELECT rolsuper FROM pg_roles WHERE rolname='egomot_app_user'"
# f болушу керек

sudo -u postgres psql -d egomot -tAc \
  "SELECT string_agg(privilege_type,',' ORDER BY privilege_type)
   FROM information_schema.table_privileges
   WHERE grantee='egomot_app' AND table_name='audit_log'"
# INSERT,SELECT болушу керек — UPDATE же DELETE эмес
```

---

## 4. Колдон орнотуу

Скриптти иштетпей, ар бир кадамды өзүң жасагың келсе.

```bash
# 4.1 Пакеттер
sudo apt-get update
sudo apt-get install -y curl git build-essential python3 postgresql postgresql-contrib

# 4.2 Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 4.3 Ролдор жана база
sudo -u postgres psql <<'SQL'
CREATE ROLE egomot_owner    LOGIN CREATEROLE PASSWORD 'ӨЗГӨРТ';
CREATE ROLE egomot_app_user LOGIN            PASSWORD 'ӨЗГӨРТ';
CREATE DATABASE egomot OWNER egomot_owner;
SQL

# 4.4 Код
git clone https://github.com/yaeraly/EGO.git /opt/egomot
cd /opt/egomot
npm ci --include=dev          # --include=dev керек: NODE_ENV=production болсо
                              # npm nest CLI менен TypeScript'ти калтырып кетет

# 4.5 .env — .env.example'дан көчүрүп, толтур
cp .env.example .env
chmod 600 .env

# 4.6 Схема (ЭЭСИ менен)
DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma generate      --schema apps/api/prisma/schema.prisma

# 4.7 Тиркеменин ролуна укук (1-миграция egomot_app ролун түзгөн)
sudo -u postgres psql -d egomot -c "GRANT egomot_app TO egomot_app_user;"

# 4.8 Seed (ЭЭСИ менен)
cd apps/api && DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma db seed && cd ../..

# 4.9 Куруу
npm run build --workspace @egomot/api
npm run build --workspace @egomot/web
```

---

## 5. Продакшн — systemd жана nginx

Үлгүлөр `deploy/` каталогунда.

```bash
# Тиркеме үчүн өзүнчө колдонуучу
sudo useradd --system --home /opt/egomot --shell /usr/sbin/nologin egomot
sudo chown -R egomot:egomot /opt/egomot
sudo chmod 600 /opt/egomot/.env

# API
sudo cp deploy/egomot-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now egomot-api
sudo systemctl status egomot-api

# nginx: статикалык PWA + /api проксиси
sudo apt-get install -y nginx
sudo cp deploy/nginx-egomot.conf /etc/nginx/sites-available/egomot
sudo ln -sf /etc/nginx/sites-available/egomot /etc/nginx/sites-enabled/egomot
sudo nginx -t && sudo systemctl reload nginx

# HTTPS
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d egomot.example.kg
```

Журналдар:

```bash
sudo journalctl -u egomot-api -f
```

---

## 6. Backup

Билим базасы күнүнө кеминде бир жолу автоматтык backup талап кылат
(Security & Backup бөлүмү), жана ал негизги база менен бир эле failure
point'то сакталбашы керек.

Күндүк backup үчүн cron:

```bash
sudo mkdir -p /var/backups/egomot
sudo tee /etc/cron.daily/egomot-backup >/dev/null <<'CRON'
#!/bin/sh
set -e
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="/var/backups/egomot/egomot-$STAMP.dump"
sudo -u postgres pg_dump -Fc egomot > "$OUT"
find /var/backups/egomot -name 'egomot-*.dump' -mtime +30 -delete
CRON
sudo chmod +x /etc/cron.daily/egomot-backup
```

> Бул файлдарды өзүнчө серверге/сактагычка көчүрүү дагы керек — бир машинада
> турган backup машина жоголсо кошо жоголот. Restore Test'ти да мезгил-мезгили
> менен жүргүз (билим базасы талап кылат): backup'ты өзүнчө тесттик базага
> кайра жүктөп, негизги таблицалар окулуп жатканын текшер.

Кайра жүктөө:

```bash
sudo -u postgres createdb egomot_restore_test
sudo -u postgres pg_restore -d egomot_restore_test /var/backups/egomot/egomot-....dump
```

---

## 7. Жаңыртуу

```bash
cd /opt/egomot
sudo systemctl stop egomot-api

git pull
npm ci --include=dev
DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma generate      --schema apps/api/prisma/schema.prisma
npm run build --workspace @egomot/api
npm run build --workspace @egomot/web

sudo systemctl start egomot-api
```

Жаңыртуудан **мурун** backup жаса. Миграцияларды кайтаруу керек болсо
`db/README.md` → «Writing a down script» бөлүмүн кара.

---

## 8. Көп кездешкен көйгөйлөр

**`sh: 1: nest: not found` куруу учурунда**
`.env` ичинде `NODE_ENV=production` турат, ал `npm ci`'ге devDependencies'ти
аттатып жиберет. `npm ci --include=dev` менен орнот.

**`permission denied for table audit_log`**
Бул күтүлгөн жүрүм-турум: тиркеме журналды өзгөртө албайт. Эгер ката
кадимки операцияда чыкса, тиркеме `INSERT` жасап жатканын текшер —
`UPDATE`/`DELETE` эч качан уруксат эмес.

**`role "egomot_app" does not exist`**
`1_append_only_logs` миграциясы колдонулган эмес. `npx prisma migrate deploy`
иштет, андан кийин `GRANT egomot_app TO egomot_app_user;`.

**`permission denied to create role`**
Миграция ролунда `CREATEROLE` жок. `ALTER ROLE egomot_owner CREATEROLE;`

**`.env жок, бирок egomot_owner ролу мурдатан бар — паролун билбейм`**
Эски версиянын катасы: жарым-жартылай өткөн орнотуудан кийин ролдор калып,
`.env` жок болсо, скрипт токтоп калчу. Азыр мындай учурда роль паролу жаңыдан
берилет. Жаңы версияны ал:

```bash
git pull
./scripts/install-ubuntu.sh
```

Эгер эски скрипт менен калып калсаң, ролдорду өчүрүп кайра баштоо да иштейт:

```bash
sudo -u postgres psql <<'SQL'
DROP DATABASE IF EXISTS egomot;
DROP OWNED BY egomot_app_user;
DROP ROLE IF EXISTS egomot_app_user;
DROP ROLE IF EXISTS egomot_owner;
DROP ROLE IF EXISTS egomot_app;
SQL
```

**Скриптти кайра иштетүү коопсузбу?**
Ооба. Төрт учур тең каралган:

| `.env` | Ролдор | Скрипт эмне кылат |
|---|---|---|
| бар | бар | эч нерсе тийбейт |
| бар | жок | ролдорду `.env`'деги пароль менен түзөт |
| жок | бар | жаңы пароль берип, ролдорду жаңыртат |
| жок | жок | баарын жаңыдан түзөт |

`.env` бар болсо, база менен ролдордун аттары ошондон алынат — скрипттин
демейкилери менен айырмаланып, эки башка орнотуу пайда болуп кетпеши үчүн.

**`Can't reach database server`**
`pg_isready` менен текшер. Башка машинадан туташсаң,
`/etc/postgresql/*/main/postgresql.conf` ичинде `listen_addresses` жана
`pg_hba.conf` ичинде уруксат керек.

**Тесттерди иштетүү**

```bash
sudo -u postgres createdb egomot_test
sudo -u postgres psql -c "GRANT ALL ON DATABASE egomot_test TO egomot_owner;"
TEST_DATABASE_URL="$MIGRATION_DATABASE_URL" npm test
```

> Тесттердин бири чектелген роль түзүп, append-only'ду чын эле текшерет,
> ошондуктан тест колдонуучусуна `CREATEROLE` керек.

**Схема менен миграциялар ажырап кетпегенин текшерүү**

```bash
npm run db:verify
```
