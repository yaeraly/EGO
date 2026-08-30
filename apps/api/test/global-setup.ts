import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

/**
 * Brings the test database up to the reference schema before any test runs.
 *
 * `migrate deploy` replays db/egomot_schema.sql verbatim (it is 0_init), so
 * the tests exercise the same CHECK constraints and indexes as production.
 */
export default function globalSetup(): void {
  const url =
    process.env.TEST_DATABASE_URL ??
    'postgresql://egomot:egomot_dev_password@localhost:5432/egomot_test?schema=public';

  execFileSync(
    path.join(__dirname, '..', '..', '..', 'node_modules', '.bin', 'prisma'),
    ['migrate', 'deploy', '--schema', path.join(__dirname, '..', 'prisma', 'schema.prisma')],
    { env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' },
  );
}
