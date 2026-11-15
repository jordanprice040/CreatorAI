import { DEV_PORTS } from '@creator/domain';
import { runCli } from './index.js';
// ADR-0108: the development API's port (4410 unless CREATOR_API_PORT says otherwise).
process.exitCode = await runCli(
  process.argv.slice(2),
  process.env.CREATOR_API_URL ??
    `http://127.0.0.1:${process.env.CREATOR_API_PORT ?? DEV_PORTS.api}`,
);
