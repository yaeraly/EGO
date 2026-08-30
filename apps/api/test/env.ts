/**
 * Test environment. Integration tests run against a dedicated database so a
 * developer's working data is never truncated.
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://egomot:egomot_dev_password@localhost:5432/egomot_test?schema=public';
process.env.JWT_SECRET ??= 'test_jwt_secret';
process.env.JWT_EXPIRES_IN ??= '1h';
