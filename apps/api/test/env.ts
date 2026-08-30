/**
 * Test environment. Integration tests run against a dedicated database so a
 * developer's working data is never truncated.
 *
 * The pool is widened because the concurrency test opens 100 transactions at
 * once; with Prisma's small default pool they would queue on connections
 * rather than on the sequence lock the test is actually about.
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://egomot:egomot_dev_password@localhost:5432/egomot_test?schema=public&connection_limit=25&pool_timeout=30';
process.env.JWT_SECRET ??= 'test_jwt_secret';
process.env.JWT_EXPIRES_IN ??= '1h';
