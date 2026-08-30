# db/

`egomot_schema.sql` belongs here — the authoritative PostgreSQL schema that the
Prisma model is derived from (spec, Module 0.1: "schema.sql — эталон").

`docker-compose.yml` mounts this directory at `/docker-entrypoint-initdb.d`, so
any `.sql` placed here is applied to a fresh `postgres` volume on first boot.

Once the file is added:

```bash
docker compose down -v && docker compose up -d postgres
npx prisma db pull   --schema apps/api/prisma/schema.prisma
npx prisma generate  --schema apps/api/prisma/schema.prisma
```

Then review the pulled models field-by-field against the SQL before committing.
