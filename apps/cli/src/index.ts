import {
  ContractError,
  HealthSchema,
  FixtureResponseSchema,
  FixtureRequestSchema,
  parse,
} from '@creator/contracts';

export async function runCli(
  args: string[],
  base = 'http://127.0.0.1:4310',
  write: (value: string) => void = console.log,
): Promise<number> {
  try {
    const url = new URL(base);
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error('CLI requires a loopback HTTP API origin.');
    const command = args[0] ?? 'health';
    if (command !== 'health' && command !== 'demo')
      throw new Error(
        'Usage: pnpm cli health | pnpm cli demo [outcome] [goal]',
      );
    const body =
      command === 'demo'
        ? parse(FixtureRequestSchema, {
            outcome: args[1] ?? 'use_existing',
            goal:
              args.slice(2).join(' ') ||
              'Compare a shared checklist with custom software',
          })
        : undefined;
    const response = await fetch(
      `${url.origin}/api/${command === 'health' ? 'health' : 'fixture'}`,
      {
        ...(body
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          : {}),
        signal: AbortSignal.timeout(5000),
      },
    );
    const json: unknown = await response.json();
    if (!response.ok)
      throw new Error(
        `API returned ${response.status}: ${JSON.stringify(json)}`,
      );
    const data =
      command === 'health'
        ? parse(HealthSchema, json)
        : parse(FixtureResponseSchema, json);
    write(JSON.stringify(data, null, 2));
    return 0;
  } catch (error) {
    write(
      JSON.stringify({
        error: error instanceof ContractError ? error.code : 'CLI_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    );
    return 1;
  }
}
