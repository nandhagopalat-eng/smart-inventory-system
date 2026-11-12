// Must be imported before any module that reads JWT configuration.
// dotenv never overrides variables that are already set.
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-only-jwt-secret-please-do-not-use-in-production';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
