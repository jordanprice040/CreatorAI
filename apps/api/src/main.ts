import { createApi } from './index.js';
try {
  const { server, config, ready, close } = createApi(process.env);
  server.on('error', (e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
  ready().then(
    () => undefined,
    (e: unknown) =>
      console.error(
        `Records unavailable: ${e instanceof Error ? e.message : 'database error'}`,
      ),
  );
  server.listen(config.api_port, config.host, () =>
    console.log(
      `Creator Agent API: http://${config.host}:${config.api_port}/api/health (no live calls; ${process.env.CREATOR_DATABASE_URL ? 'PostgreSQL records' : 'no persistence: CREATOR_DATABASE_URL unset'})`,
    ),
  );
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => void close());
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Invalid configuration',
  );
  process.exitCode = 1;
}
