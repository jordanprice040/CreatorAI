import { createPreviewServer } from '/home/user/CreatorAI/apps/api/dist/artifacts.js';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const id = '11111111-2222-4333-8444-555555555555';
const guide = {
  flows: [{ key: 'F1', name: 'Analyze input timings', steps: ['Run with --fps and the frame rate', 'Paste one press time in milliseconds per line', 'Read each press’s frame, offset and on-frame status'] }],
  examples: [
    { check_key: 'A1', statement: 'Report frame and offset for each input at 60 fps', args: ['--fps', '60'], stdin: '16.7\n33.0\n52.1\n', stdout: 'input 1: frame 1, +0.03 ms, on frame\ninput 2: frame 2, -0.33 ms, early\ninput 3: frame 3, +2.10 ms, late\n', exit_code: 0 },
    { check_key: 'A2', statement: 'Reject a frame rate of zero', args: ['--fps', '0'], stdin: '', stdout: 'error: fps must be above 0 and at most 1000\n', exit_code: 2 },
  ],
  more_examples: 4, held_out_hidden: true,
};
const mf = { id: 'a05e1ae5-0000-4000-8000-000000000000', repository: { commit: 'a05e1ae526aa' }, spec: { version: 2 }, toolchain: { backend: 'wsl2-bwrap-systemd' }, startup: { command: ['python3', '-I', 'src/main.py'] } };
const store = {
  openPreview: async () => 'sess',
  previewAccess: async (_i, _s, claim) => ({ preview: { manifest_sha256: 'ab'.repeat(32), expires_at: '2026-11-01T00:00:00Z', runs_used: 0, max_runs: 10 }, record: { manifest: mf }, guide: claim ? null : (process.env.NOGUIDE ? null : guide) }),
};
const srv = createPreviewServer(store, {});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;
const b = await chromium.launch();
for (const scheme of ['dark', 'light']) {
  const p = await b.newPage({ colorScheme: scheme, viewport: { width: 900, height: 1300 } });
  await p.goto(`http://127.0.0.1:${port}/preview/${id}?ticket=t`);
  await p.click('button[data-example]');
  console.log(scheme, JSON.stringify(await p.inputValue('#args')), JSON.stringify(await p.inputValue('#stdin')), await p.evaluate(() => document.activeElement.textContent));
  await p.screenshot({ path: `/tmp/walk/preview-${scheme}.png`, fullPage: true });
}
await b.close(); srv.close();
