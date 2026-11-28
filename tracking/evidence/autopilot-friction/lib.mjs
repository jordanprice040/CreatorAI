// Shared helpers for the autopilot friction audit walks (throwaway database, review ports
// 5183/4330/4340, fixture provider only, $0). Start ../owner-actions/stack.mjs first.
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
export const { chromium } = require('playwright');
export const WEB = 'http://127.0.0.1:5183';
export const CODE = 'walk-login-code-0123456789abcdefghij';

export async function session() {
  const dir = await mkdtemp(join(tmpdir(), 'ap-friction-'));
  const cenv = {
    ...process.env,
    CREATOR_API_URL: 'http://127.0.0.1:4330',
    CREATOR_SESSION_FILE: join(dir, 'session.json'),
  };
  const cli = async (...args) =>
    JSON.parse(
      (
        await promisify(execFile)(
          process.execPath,
          ['apps/cli/dist/main.js', ...args],
          { env: cenv },
        )
      ).stdout,
    );
  await cli('login', CODE);
  const login = await fetch(`${WEB}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: CODE }),
  });
  const s = await login.json();
  const cookie = login.headers.getSetCookie()[0].split(';')[0];
  const headers = { Cookie: cookie };
  const write = {
    ...headers,
    'Content-Type': 'application/json',
    'X-CSRF-Token': s.csrf_token,
  };
  const get = async (path) =>
    (await fetch(`${WEB}/api/${path}`, { headers })).json();
  const post = async (path, body) => {
    const r = await fetch(`${WEB}/api/${path}`, {
      method: 'POST',
      headers: write,
      body: JSON.stringify(body),
    });
    const json = await r.json().catch(() => null);
    if (r.status >= 400) throw new Error(`${path}: ${JSON.stringify(json)}`);
    return json;
  };
  const wait = async (ok, ms = 90_000) => {
    const end = Date.now() + ms;
    while (!(await ok())) {
      if (Date.now() > end) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 500));
    }
  };
  const browser = async (width = 1280) => {
    const b = await chromium.launch();
    const ctx = await b.newContext({ viewport: { width, height: 1000 } });
    const [name, value] = cookie.split('=');
    await ctx.addCookies([{ name, value, url: WEB }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    return { b, page, errors };
  };
  return { cli, get, post, wait, browser, cookie };
}
