import { createApi } from './index.js';
try {
  const { server, config } = createApi(process.env);
  server.on('error', (e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
  server.listen(config.api_port, config.host, () =>
    console.log(
      `Creator Agent fixture API: http://${config.host}:${config.api_port}/api/health (no live calls; no persistence)`,
    ),
  );
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => {
      server.closeAllConnections();
      server.close();
    });
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Invalid configuration',
  );
  process.exitCode = 1;
}
