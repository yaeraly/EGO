import { PrismaClient } from '@prisma/client';

/**
 * Module 0.5: audit_log is append-only because the database says so, not
 * because the application is careful.
 *
 * The check has to run as the restricted role. The migration test user is a
 * superuser, and superusers bypass every privilege check — asserting against
 * one would prove nothing.
 */
const RESTRICTED_ROLE = 'egomot_append_only_test';
const RESTRICTED_PASSWORD = 'append_only_test_password';

function restrictedUrl(): string {
  const base = new URL(
    process.env.DATABASE_URL ??
      'postgresql://egomot:egomot_dev_password@localhost:5432/egomot_test',
  );
  base.username = RESTRICTED_ROLE;
  base.password = RESTRICTED_PASSWORD;
  return base.toString();
}

describe('Append-only logs (Module 0.5)', () => {
  let admin: PrismaClient;
  let restricted: PrismaClient;

  beforeAll(async () => {
    admin = new PrismaClient();

    await admin.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RESTRICTED_ROLE}') THEN
          CREATE ROLE ${RESTRICTED_ROLE} LOGIN PASSWORD '${RESTRICTED_PASSWORD}';
        END IF;
      END
      $$;
    `);
    await admin.$executeRawUnsafe(`GRANT egomot_app TO ${RESTRICTED_ROLE}`);

    restricted = new PrismaClient({
      datasources: { db: { url: restrictedUrl() } },
    });
  });

  afterAll(async () => {
    await restricted.$disconnect();
    await admin.$disconnect();
  });

  beforeEach(async () => {
    await admin.$executeRawUnsafe(
      'TRUNCATE TABLE audit_log, security_log RESTART IDENTITY',
    );
    await admin.$executeRawUnsafe(`
      INSERT INTO audit_log (entity, entity_id, action, reason)
      VALUES ('documents', 'seed-entity', 'DOCUMENT_CONFIRMED', 'original reason')
    `);
    await admin.$executeRawUnsafe(`
      INSERT INTO security_log (event) VALUES ('LOGIN_FAIL')
    `);
  });

  it('grants the application role insert and select only on audit_log', async () => {
    const granted = await admin.$queryRawUnsafe<{ privilege_type: string }[]>(`
      SELECT privilege_type
      FROM information_schema.table_privileges
      WHERE grantee = 'egomot_app' AND table_name = 'audit_log'
      ORDER BY privilege_type
    `);

    expect(granted.map((g) => g.privilege_type).sort()).toEqual([
      'INSERT',
      'SELECT',
    ]);
  });

  it('lets the application append and read', async () => {
    await restricted.$executeRawUnsafe(`
      INSERT INTO audit_log (entity, action) VALUES ('settings', 'SETTING_UPDATED')
    `);

    const rows = await restricted.$queryRawUnsafe<{ n: bigint }[]>(
      'SELECT count(*) AS n FROM audit_log',
    );
    expect(Number(rows[0].n)).toBe(2);
  });

  it.each([
    ['UPDATE', `UPDATE audit_log SET reason = 'rewritten'`],
    ['DELETE', 'DELETE FROM audit_log'],
  ])('refuses %s on audit_log', async (_verb, sql) => {
    await expect(restricted.$executeRawUnsafe(sql)).rejects.toThrow(
      /permission denied/i,
    );

    const [row] = await admin.$queryRawUnsafe<{ reason: string; n: bigint }[]>(
      'SELECT reason, count(*) OVER () AS n FROM audit_log',
    );
    expect(row.reason).toBe('original reason');
    expect(Number(row.n)).toBe(1);
  });

  it.each([
    ['UPDATE', `UPDATE security_log SET event = 'LOGIN_OK'`],
    ['DELETE', 'DELETE FROM security_log'],
  ])('refuses %s on security_log', async (_verb, sql) => {
    await expect(restricted.$executeRawUnsafe(sql)).rejects.toThrow(
      /permission denied/i,
    );

    const rows = await admin.$queryRawUnsafe<{ event: string }[]>(
      'SELECT event FROM security_log',
    );
    expect(rows).toEqual([{ event: 'LOGIN_FAIL' }]);
  });

  it('still allows the application to write ordinary tables', async () => {
    await restricted.$executeRawUnsafe(`
      INSERT INTO settings (key, value) VALUES ('append.only.probe', '1'::jsonb)
    `);
    await restricted.$executeRawUnsafe(`
      UPDATE settings SET value = '2'::jsonb WHERE key = 'append.only.probe'
    `);
    await restricted.$executeRawUnsafe(
      `DELETE FROM settings WHERE key = 'append.only.probe'`,
    );
  });
});
