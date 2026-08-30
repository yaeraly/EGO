/**
 * Teaches JSON.stringify how to write a BigInt.
 *
 * Several tables use BIGSERIAL keys — the ledgers, the logs, the status
 * history — and Prisma returns those as BigInt. JSON has no such type, so
 * without this any endpoint returning one of those rows fails with
 * "Do not know how to serialize a BigInt", as a 500 rather than a type error.
 *
 * Serialising as a string rather than a number is deliberate: an id past
 * 2^53 would lose precision as a JSON number, and a client that treats ids as
 * opaque strings never has that problem.
 *
 * Patching the prototype is heavy-handed, but the alternative is remembering
 * to convert in every repository that touches a BIGSERIAL table, and the one
 * that is forgotten becomes a 500 in production.
 */
export function enableBigIntJson(): void {
  const proto = BigInt.prototype as unknown as { toJSON?: () => string };
  proto.toJSON ??= function toJSON(this: bigint): string {
    return this.toString();
  };
}
