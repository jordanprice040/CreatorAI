import { createInterface } from 'node:readline';
import {
  adoptStudio,
  backupStudio,
  dropRehearsals,
  initStudio,
  inspectDatabase,
  migrateStudio,
  parseStudioInput,
  restoreStudio,
  serveStudio,
  type StudioEvent,
} from './studio.js';

// Installed-studio child (ADR-0041). stdout carries only protocol events, so every console
// method is sent to stderr, which the supervisor writes to the service log.
const write = process.stdout.write.bind(process.stdout);
const emit = (e: StudioEvent) => void write(JSON.stringify(e) + '\n');
for (const k of ['log', 'info', 'warn', 'debug'] as const)
  console[k] = (...a: unknown[]) => console.error(...a);

const mode = process.argv[2] ?? '';
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const first = new Promise<string>((ok, fail) => {
  const timer = setTimeout(() => fail(new Error('No studio input.')), 15000);
  lines.once('line', (l) => {
    clearTimeout(timer);
    ok(l);
  });
  lines.once('close', () => fail(new Error('No studio input.')));
});
// Supervisor exit (closed stdin) or an explicit shutdown command both stop the service.
const stop = new Promise<void>((done) => {
  lines.on('line', (l) => {
    if (l.trim() === '{"cmd":"shutdown"}') done();
  });
  lines.once('close', () => done());
});

let code = 1;
try {
  const input = parseStudioInput(await first);
  if (mode === 'serve') code = await serveStudio(input, emit, stop);
  else {
    const result =
      mode === 'inspect'
        ? await inspectDatabase(input.database_url)
        : mode === 'migrate'
          ? await migrateStudio(input)
          : mode === 'init'
            ? await initStudio(input)
            : mode === 'adopt'
              ? await adoptStudio(input)
              : mode === 'backup'
                ? await backupStudio(input)
                : mode === 'restore'
                  ? await restoreStudio(input)
                  : mode === 'drop-rehearsals'
                    ? await dropRehearsals(input)
                    : null;
    if (result === null) throw new Error(`Unknown studio command: ${mode}`);
    emit({ event: 'result', mode, result });
    code = 'ok' in result && result.ok === false ? 2 : 0;
  }
} catch (e) {
  emit({
    event: 'error',
    code:
      e && typeof e === 'object' && 'code' in e && typeof e.code === 'string'
        ? e.code
        : 'STARTUP_FAILED',
    message: e instanceof Error ? e.message : 'Studio command failed.',
  });
  code = 1;
}
lines.close();
process.stdin.destroy();
process.exitCode = code;
// Lingering handles (an idle socket) must not keep a stopped service alive.
setTimeout(() => process.exit(code), 3000).unref();
