import { runCli } from './index.js';
process.exitCode = await runCli(
  process.argv.slice(2),
  process.env.CREATOR_API_URL,
);
