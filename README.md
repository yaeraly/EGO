# EGOMOT

Business management system. NestJS + Prisma + PostgreSQL API, React + Vite PWA client.

## Status

**Module 0 — Foundation: task 0.1 (project skeleton) partially complete.**

| Task | State |
|---|---|
| 0.1 Project skeleton (NestJS, Vite PWA, docker-compose) | done |
| 0.1 Prisma schema from `db/egomot_schema.sql` | **blocked** — reference SQL missing |
| 0.2 Auth + Users + PIN | blocked on schema |
| 0.3 Documents core + numbering | blocked on schema |
| 0.4 Payment Accounts + TRN | blocked on schema |
| 0.5 Settings + Audit | blocked on schema |
| 0.6 Business Days skeleton | blocked on schema |

### Missing inputs

The technical spec references three files that are not in this repository. Work
that depends on them has not been started, and no substitute has been invented:

- `db/egomot_schema.sql` — the authoritative data model ("эталон"). Task 0.1
  derives the Prisma schema from it. Every later task names tables from it
  (`users`, `security_log`, `documents`, `doc_sequences`, `payment_accounts`,
  `account_movements`, `settings`, `audit_log`, `business_days`,
  `currency_layers`, `currency_layer_consumptions`).
- `docs/EGOMOT_Knowledge_Base_v2.1.md` — the specification the modules cite by
  section (§2 roles, §19 accounts, §26 categories, §3 capital, §10-А currency
  exchange, Security, Document Numbering Standard, Period Lock).
- `CLAUDE.md` — the working rules the spec says to follow.

## Layout

```
apps/api/            NestJS + Prisma API
  prisma/schema.prisma   datasource only; models pending db/egomot_schema.sql
  src/prisma/            PrismaService (global module)
  src/health/            GET /api/health - liveness + DB check
apps/web/            React 19 + Vite 6 PWA
db/                  reference SQL schema (applied by postgres on first boot)
docs/                knowledge base
docker-compose.yml   postgres + api + web
```

## Running

```bash
cp .env.example .env
docker compose up
```

API on `http://localhost:3000/api`, web on `http://localhost:5173`.

Without Docker:

```bash
npm install
npm run db:generate
npm run dev:api      # needs a reachable DATABASE_URL
npm run dev:web
```

## Conventions

- **Money is never a float.** All monetary amounts use `Decimal`
  (`decimal.js` / `Prisma.Decimal`). An ESLint rule in `apps/api/eslint.config.mjs`
  blocks `parseFloat`; this is the foundation of Module 1 acceptance criterion 5.
- Documents follow `DRAFT -> CONFIRMED -> CANCELLED` (cancel from `DRAFT` only).
- `audit_log` is append-only; staff records are deactivated (`INACTIVE`/`BLOCKED`),
  never deleted.
