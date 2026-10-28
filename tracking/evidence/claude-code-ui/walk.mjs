// Models and connections: Claude Code connection browser walk (ADR-0050), fixture mode.
// Starts the real API and the built web app on a throwaway database with a FAKE `claude`
// (tests/dist/claude-fake.js) in a temporary folder, then drives headless Chromium through the
// whole owner flow: add, check sign-in, confirm extra usage off, accept caps, approve and run
// one verification call. No real Claude Code, Claude account or model is used.
// Usage (after `pnpm build` on an EMPTY throwaway database, never the installed app's):
//   CREATOR_DATABASE_URL=... CREATOR_DEV_LOGIN_CODE=<32+ chars> \
//     node tracking/evidence/claude-code-ui/walk.mjs [playwright module] [chromium path]
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview as vitePreview } from 'vite';
import { createApi } from '../../../apps/api/dist/index.js';
import { SUBSCRIBED, fakeCalls, setFake, writeFakeClaude } from '../../../tests/dist/claude-fake.js';

const [, , pwPath = 'playwright', chromiumPath] = process.argv;
const pw = await import(pwPath);
const { chromium } = pw.chromium ? pw : pw.default;
const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, 'screens');
await mkdir(shots, { recursive: true });
const CODE = process.env.CREATOR_DEV_LOGIN_CODE;
if (!CODE || !process.env.CREATOR_DATABASE_URL) throw new Error('missing env');

const tmp = mkdtempSync(join(tmpdir(), 'creator-claude-walk-'));
const bin = writeFakeClaude(join(tmp, 'bin'));
const configDir = join(tmp, 'claude-code');
// Starts signed in with an API key, to show the refusal, then switches to a subscription login.
setFake(configDir, { status: { loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty' } });
const env = {
  ...process.env,
  CREATOR_WORKER: 'off',
  CREATOR_CLAUDE_CODE_BIN: bin,
  CREATOR_CLAUDE_CODE_CONFIG_DIR: configDir,
};
const api = createApi(env);
const { config } = api;
api.server.listen(config.api_port, config.host);
await once(api.server, 'listening');
await api.ready();
const web = await vitePreview({ root: 'apps/web', configFile: 'apps/web/vite.config.ts' });
const BASE = `http://${config.host}:${config.web_port}`;
const API = `http://${config.host}:${config.api_port}/api`;

const login = await fetch(`${API}/auth/dev-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: CODE }),
});
const cookie = login.headers.getSetCookie()[0].split(';')[0];
const csrf = (await login.json()).csrf_token;
const ws = await (
  await fetch(`${API}/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf },
    body: JSON.stringify({ name: 'Claude Code walk (fixture)', record_mode: 'fixture' }),
  })
).json();

const steps = [];
const problems = [];
const browser = await chromium.launch(chromiumPath ? { executablePath: chromiumPath } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && problems.push(`console: ${m.text()}`));
const step = async (name, fn) => {
  console.log(`… ${name}`);
  try {
    steps.push({ name, ok: true, detail: (await fn()) ?? null });
  } catch (e) {
    steps.push({ name, ok: false, error: String(e?.message ?? e).split('\n')[0] });
    await page.screenshot({ path: join(shots, `failed-${steps.length}.png`), fullPage: true }).catch(() => undefined);
  }
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
const see = (text) => page.getByText(text).first().waitFor();
const button = (name) => page.getByRole('button', { name, exact: true });

await step('sign in and open Models and connections', async () => {
  await page.goto(BASE);
  await page.getByLabel('Login code').fill(CODE);
  await page.keyboard.press('Enter');
  await page.waitForLoadState('networkidle');
  await page.goto(`${BASE}/#/models?ws=${ws.id}`);
  await page.locator('#models-title').waitFor();
  await button('Add Claude Code on this computer').waitFor();
  await button('Add a ChatGPT plan connection').waitFor();
  await page.screenshot({ path: join(shots, '01-empty.png'), fullPage: true });
});
await step('add Claude Code; there is no Claude sign-in button, only a status check', async () => {
  await button('Add Claude Code on this computer').click();
  await see('Sign in to Claude Code yourself');
  assert((await page.getByRole('button', { name: /Continue with ChatGPT/ }).count()) === 0, 'ChatGPT sign-in shown');
  assert((await page.getByRole('button', { name: /sign in with claude/i }).count()) === 0, 'Claude sign-in button shown');
  await see('Claude Code on this computer has not been checked');
});
await step('a Claude Code signed in with an API key is refused', async () => {
  await button('Check Claude Code').click();
  await see('not a Claude subscription login');
  await see('Claude Code is using an API key or another credential');
  const folder = await page.locator('pre code').textContent();
  assert(folder.includes(configDir), `folder not shown: ${folder}`);
  await page.screenshot({ path: join(shots, '02-api-key-refused.png'), fullPage: true });
});
await step('after the owner signs in with their Claude account, check, confirm and accept', async () => {
  setFake(configDir, { status: SUBSCRIBED });
  await button('Check Claude Code').click();
  await see('owner@example.test');
  await page.getByRole('checkbox').check();
  await button('Record confirmation').click();
  await see('Confirmed off on');
  await button('Accept these caps').click();
  await page.getByText('Why model calls are blocked').waitFor({ state: 'detached' });
  await page.screenshot({ path: join(shots, '03-ready.png'), fullPage: true });
});
await step('approve and run one verification call', async () => {
  await page.getByLabel('Model', { exact: true }).fill('claude-test-model');
  await button('Approve one call').click();
  await button('Run the verification call').click();
  await see('claude-test-model · responses · verified');
  const runs = fakeCalls(configDir).filter((c) => c.args[0] === '-p');
  assert(runs.length === 1, `runs ${runs.length}`);
  assert(runs[0].args.includes('--restricted') && !runs[0].env.includes('ANTHROPIC_API_KEY'), 'run not locked down');
  await page.screenshot({ path: join(shots, '04-verified.png'), fullPage: true });
});
await step('phone width: no horizontal page scroll', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator('#models-title').waitFor();
  await see('claude-test-model · responses · verified');
  assert((await page.getByText('Sign in to Claude Code yourself').count()) === 0, 'sign-in help still shown once signed in');
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.screenshot({ path: join(shots, '05-phone.png'), fullPage: true });
  assert(extra <= 0, `scrolls by ${extra}px`);
});

await browser.close();
await new Promise((r) => web.httpServer.close(r));
await api.close();
const result = { when: new Date().toISOString(), mode: 'fixture', fake_claude: true, steps, problems };
await writeFile(join(here, 'walk.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
process.exit(steps.every((s) => s.ok) && problems.length === 0 ? 0 : 1);
