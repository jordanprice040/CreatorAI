// B3 export-start check: a downloaded package, extracted with the system tar (as Windows 10+
// and Linux both have), started with the manifest's own startup command outside the studio,
// and checked against the manifest's frozen cases. Run in a throwaway container only.
//   node export-start.mjs <archive.tar> <manifest.json>
// Python: each case runs `<startup command> <args>` with its stdin; stdout+stderr must equal the
// expected output and the exit code must match. Web: the startup command serves site/ on
// 127.0.0.1:8000, and Playwright's Chromium (not the studio's pinned checker) plays each case's
// steps on a fresh page; page errors and requests to other hosts fail the case.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const [archive, manifestFile] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
const dir = mkdtempSync(join(tmpdir(), 'b3-export-'));
execFileSync('tar', ['-xf', archive, '-C', dir]);
const command = manifest.startup.command;
const results = [];
if (manifest.toolchain.recipe !== 'static-web/1') {
  for (const c of manifest.tests.cases) {
    const r = spawnSync(
      'sh',
      ['-c', 'exec "$@" 2>&1', 'start', ...command, ...c.args],
      { cwd: dir, input: c.stdin, timeout: 20000 },
    );
    const out = r.stdout.toString();
    results.push({
      check_key: c.check_key,
      passed: out === c.stdout && r.status === c.exit_code,
      ...(out === c.stdout ? {} : { printed: out }),
    });
  }
} else {
  const server = spawn(command[0], command.slice(1), {
    cwd: dir,
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 50; i++) {
      try {
        await fetch('http://127.0.0.1:8000/');
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    const { chromium } = createRequire(import.meta.url)('playwright');
    const browser = await chromium.launch();
    for (const c of manifest.tests.cases) {
      const page = await browser.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(`page error: ${e}`));
      page.on('request', (q) => {
        if (!q.url().startsWith('http://127.0.0.1:8000/'))
          problems.push(`outside request: ${q.url()}`);
      });
      page.on('dialog', (d) => {
        problems.push('dialog');
        void d.dismiss();
      });
      let failed = null;
      try {
        await page.goto(`http://127.0.0.1:8000${c.page}`);
        for (const [i, s] of c.steps.entries()) {
          const el = s.selector ? page.locator(s.selector) : null;
          const t = { timeout: 3000 };
          const norm = async () =>
            (
              await el.evaluate((n) =>
                'value' in n &&
                ['INPUT', 'SELECT', 'TEXTAREA'].includes(n.tagName)
                  ? n.value
                  : n.innerText,
              )
            )
              .replace(/\s+/g, ' ')
              .trim();
          const until = async (ok) => {
            const end = Date.now() + 3000;
            for (;;) {
              if (await ok().catch(() => false)) return;
              if (Date.now() > end)
                throw new Error(
                  `step ${i + 1} ${s.action} ${s.selector ?? ''}`,
                );
              await page.waitForTimeout(100);
            }
          };
          if (s.action === 'fill') await el.fill(s.value, t);
          else if (s.action === 'click' || s.action === 'check')
            await el.click(t);
          else if (s.action === 'select') await el.selectOption(s.value, t);
          else if (s.action === 'press') await el.press(s.key, t);
          else if (s.action === 'goto')
            await page.evaluate((h) => {
              location.hash = h;
            }, s.hash ?? s.value);
          else if (s.action === 'expect_text')
            await until(
              async () => (await norm()) === s.text.replace(/\s+/g, ' ').trim(),
            );
          else if (s.action === 'expect_contains')
            await until(async () => (await norm()).includes(s.text));
          else if (s.action === 'expect_visible')
            await until(() => el.isVisible());
          else if (s.action === 'expect_hidden')
            await until(
              async () => (await el.count()) === 0 || !(await el.isVisible()),
            );
          else if (s.action === 'expect_count')
            await until(async () => (await el.count()) === s.count);
          else if (s.action === 'expect_title')
            await until(async () => (await page.title()) === s.text);
          else throw new Error(`unknown step ${s.action}`);
        }
        await page.waitForTimeout(1000);
      } catch (e) {
        failed = String(e.message ?? e).split('\n')[0];
      }
      results.push({
        check_key: c.check_key,
        page: c.page,
        passed: !failed && !problems.length,
        ...(failed ? { failed } : {}),
        ...(problems.length ? { problems } : {}),
      });
      await page.close();
    }
    await browser.close();
  } finally {
    server.kill();
  }
}
console.log(
  JSON.stringify(
    {
      recipe: manifest.toolchain.recipe,
      startup: command.join(' '),
      passed: results.filter((r) => r.passed).length,
      total: results.length,
      results,
    },
    null,
    2,
  ),
);
