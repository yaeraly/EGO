# db/

`egomot_schema.sql` is the authoritative data model — the reference the spec
calls "эталон" (Module 0.1). **It is the source of truth, not the Prisma
schema.** 73 tables, 31 enums.

## Why the SQL leads

Prisma cannot express `CHECK` constraints or expression indexes, so a
Prisma-authored migration would silently drop them — 34 CHECK constraints and
the `idx_aliases_search` GIN index among them. The workflow keeps the SQL
authoritative:

```
db/egomot_schema.sql
  └─> apps/api/prisma/migrations/0_init/migration.sql   (verbatim copy)
        └─> prisma db pull  ──>  apps/api/prisma/schema.prisma
```

`prisma/migrations/0_init/migration.sql` is a verbatim copy of this file, so
`prisma migrate deploy` reproduces the reference exactly — CHECK constraints
included. Verified on a clean database: 73 tables + `_prisma_migrations`, 34
CHECK constraints.

`docker-compose.yml` also mounts this directory at
`/docker-entrypoint-initdb.d`, so the SQL is applied to a fresh `postgres`
volume on first boot.

## Changing the model

1. Edit `db/egomot_schema.sql` — never `schema.prisma` by hand.
2. Add a new `apps/api/prisma/migrations/<n>_<name>/` with **both**
   `migration.sql` (forward DDL) and `down.sql` (CLAUDE.md: "Миграциялар
   кайтарылгыс болбосун — ар бирине down script"). Do not rewrite `0_init`;
   it is already applied everywhere.
3. `npx prisma migrate deploy --schema apps/api/prisma/schema.prisma`
4. `npx prisma db pull --schema apps/api/prisma/schema.prisma`
5. `npx prisma generate --schema apps/api/prisma/schema.prisma`
6. `npm run db:verify` — proves the reference SQL and the migrations still
   describe the same schema.

### Writing a down script

Each `down.sql` reverses exactly its own migration and ends by removing its row
from `_prisma_migrations`; Prisma's ledger is not part of the schema, so
without that line `migrate deploy` still believes the migration is applied and
will not re-run it.

Run them in reverse order:

```bash
psql "$DATABASE_URL" -f apps/api/prisma/migrations/2_idempotency_keys/down.sql
psql "$DATABASE_URL" -f apps/api/prisma/migrations/1_append_only_logs/down.sql
psql "$DATABASE_URL" -f apps/api/prisma/migrations/0_init/down.sql
```

`0_init/down.sql` destroys every table and enum — it exists so the baseline is
reversible in a test or staging database, not for production. The
`egomot_app` role is a cluster object shared by every database, so
`1_append_only_logs/down.sql` strips its privileges here but leaves the role
itself; that script says how to retire it.

Model and field names are kept exactly as the SQL table and column names
(`payment_accounts`, not `PaymentAccount`). The 1:1 correspondence with the
reference is deliberate — renaming 73 models by hand would invite drift.

## Rebuilding from scratch

```bash
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
npx prisma generate        --schema apps/api/prisma/schema.prisma
```
