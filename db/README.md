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
2. Add a new `apps/api/prisma/migrations/<n>_<name>/migration.sql` with the
   forward DDL (do not rewrite `0_init`; it is already applied everywhere).
3. `npx prisma migrate deploy --schema apps/api/prisma/schema.prisma`
4. `npx prisma db pull --schema apps/api/prisma/schema.prisma`
5. `npx prisma generate --schema apps/api/prisma/schema.prisma`

Model and field names are kept exactly as the SQL table and column names
(`payment_accounts`, not `PaymentAccount`). The 1:1 correspondence with the
reference is deliberate — renaming 73 models by hand would invite drift.

## Rebuilding from scratch

```bash
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
npx prisma generate        --schema apps/api/prisma/schema.prisma
```
