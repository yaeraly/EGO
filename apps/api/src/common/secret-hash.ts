import * as argon2 from 'argon2';

/**
 * Credential hashing for passwords and PINs (Security section).
 *
 * Plaintext credentials are never stored and never logged — only the argon2id
 * digest reaches the database.
 */
export function hashSecret(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifySecret(
  hash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // A malformed or truncated digest must read as "wrong credential",
    // never as an error that leaks which account exists.
    return false;
  }
}

/**
 * An argon2id digest of a value no caller can supply. Verifying against it
 * costs the same as a real check, so a missing user takes the same time as a
 * wrong password — closing the timing side channel that would otherwise
 * enumerate accounts.
 */
let dummyHash: Promise<string> | null = null;

export function burnVerifyTime(plain: string): Promise<boolean> {
  dummyHash ??= hashSecret(`no-such-user:${process.pid}:${Date.now()}`);
  return dummyHash.then((hash) => verifySecret(hash, plain));
}
