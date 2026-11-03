// Starts the studio on the review ports (5183/4330/4340) against a throwaway database, fixture
// provider only. Usage: CREATOR_DATABASE_URL=… node stack.mjs (from the repo root).
process.env.CREATOR_DEV_LOGIN_CODE = 'walk-login-code-0123456789abcdefghij';
process.env.CREATOR_API_PORT = '4330';
process.env.CREATOR_PREVIEW_PORT = '4340';
process.env.CREATOR_WEB_PORT = '5183';
await import('../../../scripts/dev.mjs');
