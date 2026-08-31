import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Finds the `.env` that belongs to this checkout.
 *
 * The file lives at the repository root (`.env.example` is there), but the
 * processes that need it start from three different directories: the API from
 * `apps/api` (npm workspaces set the workspace as cwd), the Prisma CLI from
 * wherever the developer typed the command, and the seed from `apps/api` again
 * because that is where the `prisma.seed` entry lives. Resolving relative to
 * cwd therefore finds the file for one of them and not the others, which is how
 * `DATABASE_URL` ends up as an empty string. Walking up from this file instead
 * gives the same answer for all three.
 */
export function findEnvFile(from: string = __dirname): string | undefined {
  let dir = from;
  for (;;) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * Loads that file into `process.env` for a plain script (the seed), which has
 * no Nest `ConfigModule` to do it.
 *
 * Variables already present in the environment win, so an explicit
 * `DATABASE_URL=... npx prisma db seed` still points where it says.
 */
export function loadEnvFile(from: string = __dirname): string | undefined {
  const file = findEnvFile(from);
  if (file) {
    process.loadEnvFile(file);
  }
  return file;
}
