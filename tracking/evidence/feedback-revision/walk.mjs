// Browser walk for Try › feedback › "Revise the spec from this feedback" (audit L-8), against
// a throwaway database on the review ports with one `pnpm cli seed-selection` workspace. The
// spec and its revision are real; the package is not (building one needs the isolated
// worker), so the artifact list, its detail and the feedback routes are answered here, and
// the revision request the form sends is checked against the contract and then saved as a
// real spec revision. Usage:
//   node walk.mjs <login-code> <workspace> <out-dir>
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import {
  ArtifactDetailSchema,
  ArtifactSummarySchema,
  FeedbackRevisionRequestSchema,
  FeedbackSchema,
} from '../../../packages/contracts/dist/index.js';
const { chromium } = createRequire(import.meta.url)('playwright');

const [code, ws, out = '.'] = process.argv.slice(2);
const WEB = 'http://127.0.0.1:5183';
const login = await fetch(`${WEB}/api/auth/dev-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code }),
});
if (!login.ok) throw new Error(`login failed ${login.status}`);
const session = await login.json();
const cookie = login.headers.getSetCookie()[0].split(';')[0];
const headers = {
  'Content-Type': 'application/json',
  Cookie: cookie,
  'X-CSRF-Token': session.csrf_token,
};
const apiCall = async (path, body) => {
  const r = await fetch(`${WEB}/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
};
const base = `workspaces/${ws}`;
const [spec] = await apiCall(`${base}/entities?kind=specification`);
console.log(
  'spec:',
  spec.title.slice(0, 60),
  'v' + spec.version,
  spec.body.format,
);

// One verified package of the current spec version, with three feedback items.
const h = (c) => c.repeat(64);
const sha = (c) => c.repeat(40);
const now = new Date().toISOString();
const artifactId = randomUUID();
const av = (state, reason) => ({ state, reason });
const availability = {
  source_archive: av('available', 'Archive hashed.'),
  runnable_demo: av('unavailable', 'Walk stand-in: no worker.'),
  native_installer: av('unavailable', 'Not built.'),
};
const summary = ArtifactSummarySchema.parse({
  id: artifactId,
  entity_id: randomUUID(),
  state: 'verified',
  manifest_sha256: h('a'),
  archive_sha256: h('b'),
  spec: { id: spec.id, version: spec.version },
  commit: sha('c'),
  backend: 'wsl2-bwrap-systemd',
  availability,
  current: true,
  previous_id: null,
  created_at: now,
});
const fb = (category, text, status, version = spec.version) => ({
  id: randomUUID(),
  artifact_id: artifactId,
  manifest_sha256: h('a'),
  spec: { id: spec.id, version },
  category,
  text,
  status,
  rationale: status === 'submitted' ? null : 'Owner accepted for revision',
  revision: null,
  version: status === 'submitted' ? 1 : 2,
  created_at: now,
});
const feedback = [
  fb(
    'change_request',
    'Show the total of no-shows per clinic at the end, not only per day.\nA weekly view would help too.',
    'submitted',
  ),
  fb('defect', 'An empty input file prints a traceback.', 'accepted'),
];
const manifest = {
  format: 'build-manifest/1',
  id: artifactId,
  created_at: now,
  state: 'verified',
  workspace_id: ws,
  product_id: randomUUID(),
  owner_id: randomUUID(),
  spec: {
    id: spec.id,
    version: spec.version,
    hash: h('d'),
    freeze_id: randomUUID(),
  },
  task: { id: randomUUID(), key: 'T1', hash: h('e') },
  build: {
    id: randomUUID(),
    plan_hash: h('f'),
    prompt_hash: h('1'),
    calls: 2,
    repairs: 0,
    fixture_roles: false,
  },
  repository: {
    commit: sha('c'),
    base_commit: sha('2'),
    initial_commit: sha('3'),
    git_version: 'git 2.43',
  },
  template: { id: 'checklist/1', hash: h('4') },
  toolchain: {
    recipe: 'python-build/1',
    recipe_hash: h('5'),
    policy_hash: h('6'),
    bridge_hash: h('7'),
    backend: 'wsl2-bwrap-systemd',
    python: '3.12',
    supervisor_node: '22',
  },
  dependencies: {
    kind: 'python-stdlib-only',
    lockfile: null,
    note: 'Standard library only.',
  },
  package: {
    kind: 'source_archive',
    file: 'source.tar',
    media_type: 'application/x-tar',
    sha256: h('b'),
    bytes: 10240,
    input_hash: h('8'),
    files: [{ path: 'src/main.py', sha256: h('9'), bytes: 900 }],
  },
  availability,
  startup: {
    runtime: 'python3',
    command: ['python3', '-I', 'src/main.py'],
    network: 'none',
    requirements: [],
    readiness_case: 'A1',
  },
  tests: {
    cases: [
      { check_key: 'A1', args: [], stdin: '', stdout: 'ok\n', exit_code: 0 },
    ],
    build_qa: [],
    package: [],
  },
  costs: {
    broker_calls: 0,
    settled_nano_usd: '0',
    unsettled_attempts: 0,
    local_compute: 'not_metered_by_studio',
  },
  lineage: { previous: null, feedback_ids: [] },
  limitations: [],
};
const detail = () =>
  ArtifactDetailSchema.parse({
    artifact: summary,
    manifest,
    previews: [],
    feedback: feedback.map((f) => FeedbackSchema.parse(f)),
    integrity: { checked_at: now, ok: true, detail: 'Walk stand-in.' },
  });

const sent = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
const [name, value] = cookie.split('=');
await ctx.addCookies([{ name, value, url: WEB }]);
const json = (route, body, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
await ctx.route(`**/api/${base}/artifacts`, (r) => json(r, [summary]));
await ctx.route(`**/api/${base}/artifacts/${artifactId}`, (r) =>
  json(r, detail()),
);
await ctx.route(`**/api/${base}/feedback/*/decide`, (r) => {
  const id = r.request().url().split('/').at(-2);
  const f = feedback.find((x) => x.id === id);
  Object.assign(f, {
    status: 'accepted',
    rationale: 'Owner accepted for revision',
    version: f.version + 1,
  });
  return json(r, f);
});
await ctx.route(`**/api/${base}/feedback/*/revision`, async (r) => {
  const id = r.request().url().split('/').at(-2);
  const body = r.request().postDataJSON();
  sent.push(body);
  const req = FeedbackRevisionRequestSchema.parse(body);
  const f = feedback.find((x) => x.id === id);
  // The real route compares with the spec as stored now, not as the page loaded it.
  const current = (await apiCall(`${base}/specs/${spec.id}`)).spec.version;
  if (
    req.expected_version !== f.version ||
    req.expected_spec_version !== f.spec.version ||
    current !== f.spec.version
  )
    return json(
      r,
      { error: { code: 'VERSION_CONFLICT', message: 'stale' } },
      409,
    );
  // What reviseFromFeedback does for the spec: the next version with the same body.
  const s = await apiCall(`${base}/specs/${spec.id}/revisions`, {
    expected_version: req.expected_spec_version,
    title: req.title,
    content: req.content,
    reason: `${req.reason} (feedback ${id})`.slice(0, 300),
  });
  Object.assign(f, {
    status: 'revised',
    revision: { id: spec.id, version: s.spec.version },
    version: f.version + 1,
  });
  return json(r, f);
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${WEB}/#/projects/try?ws=${ws}`);
await page.waitForTimeout(2500);
const shot = (n) =>
  page.screenshot({ path: `${out}/${n}.png`, fullPage: true });
const buttons = page.getByRole('button', {
  name: 'Revise the spec from this feedback',
});
console.log('revise buttons before accepting:', await buttons.count());
await shot('01-accepted-item');

// Accept the submitted item: its notice now points at the button, not the command line.
await page.getByRole('button', { name: 'Accept' }).click();
await page.waitForTimeout(1200);
console.log(
  'notice after accept:',
  await page.locator('.artifact p.small[role=status]').first().textContent(),
);
console.log('revise buttons after accepting:', await buttons.count());

// Open the form from the first item (the one just accepted).
await buttons.first().click();
await page.waitForTimeout(1200);
const form = page.locator('form.spec-form');
console.log('form heading:', await form.locator('h3').textContent());
console.log(
  'quoted feedback:',
  JSON.stringify(await form.locator('.sf-feedback').textContent()),
);
console.log(
  'prefilled reason:',
  JSON.stringify(await page.locator('[id="sf-reason"]').inputValue()),
);
console.log(
  'title prefilled from spec:',
  (await page.locator('[id="sf-title"]').inputValue()) === spec.title,
);
console.log(
  'other revise buttons while open:',
  await buttons.count(),
  'disabled:',
  await buttons.first().isDisabled(),
);
console.log(
  'also accepted notice:',
  JSON.stringify(await form.locator('.notice[role=note]').textContent()),
);
console.log(
  'reason box max length:',
  await page.locator('[id="sf-reason"]').getAttribute('maxlength'),
);
await shot('02-form-open');

// An empty reason is refused before anything is sent.
await page.locator('[id="sf-reason"]').fill('');
await page.getByRole('button', { name: 'Save new version' }).click();
await page.waitForTimeout(300);
console.log(
  'empty reason:',
  await page.locator('#sf-reason-error').textContent(),
  'sent:',
  sent.length,
);
await page
  .locator('[id="sf-reason"]')
  .fill('Preview feedback: add per-clinic totals at the end.');
await page
  .locator('[id="sf-scope"]')
  .fill(
    (await page.locator('[id="sf-scope"]').inputValue()) +
      '\nPer-clinic totals at the end of the report',
  );
await page.getByRole('button', { name: 'Save new version' }).click();
await page.waitForTimeout(2000);
console.log(
  'sent:',
  sent.length,
  'expected_version',
  sent[0]?.expected_version,
  'expected_spec_version',
  sent[0]?.expected_spec_version,
);
console.log(
  'notice after save:',
  await page.locator('.artifact p.small[role=status]').first().textContent(),
);
console.log(
  'item now:',
  await page.locator('.feedback li').first().textContent(),
);
const after = await apiCall(`${base}/specs/${spec.id}`);
console.log(
  'real spec now v' + after.spec.version,
  'scope has totals:',
  (await apiCall(`${base}/entities/${spec.id}`)).entity.body.scope.some((s) =>
    /Per-clinic totals/.test(s),
  ),
);
await shot('03-saved');

// The other accepted item was given on the old version: it says so without a click.
console.log('revise buttons after the revision:', await buttons.count());
console.log(
  'superseded item:',
  await page.locator('.feedback li p.small[role=status]').textContent(),
);
await shot('04-stale');

// Phone width with the form open on a fresh accepted item.
feedback.push(
  fb(
    'change_request',
    'Name the clinic in the header.',
    'accepted',
    after.spec.version,
  ),
);
summary.spec.version = after.spec.version;
await page.setViewportSize({ width: 390, height: 844 });
await page.reload();
await page.waitForTimeout(2500);
await page
  .getByRole('button', { name: 'Revise the spec from this feedback' })
  .last()
  .click();
await page.waitForTimeout(1200);
const wide = await page.evaluate(
  () => document.documentElement.scrollWidth > window.innerWidth,
);
console.log('phone: form open', await form.count(), 'horizontal scroll', wide);
await shot('05-phone');
await page.getByRole('button', { name: 'Cancel' }).click();
console.log('after cancel: form', await form.count());

// Stale while open: another revision is saved behind the open form (review L-2).
await page.setViewportSize({ width: 1280, height: 900 });
await buttons.last().click();
await page.waitForTimeout(1200);
const behind = await apiCall(`${base}/entities/${spec.id}`);
// The stored body carries the selection it came from; a revision takes only the content.
const { format, alternative, selection_id, ...content } = behind.entity.body;
await apiCall(`${base}/specs/${spec.id}/revisions`, {
  expected_version: behind.entity.version,
  title: behind.entity.title,
  content: {
    ...content,
    non_goals: [...content.non_goals, 'Revised behind the form'],
  },
  reason: 'Walk: revised behind the open form',
});
await page.locator('[id="sf-reason"]').fill('Name the clinic in the header.');
await page
  .locator('[id="sf-scope"]')
  .fill(
    (await page.locator('[id="sf-scope"]').inputValue()) +
      '\nClinic name in the header',
  );
await page.getByRole('button', { name: 'Save new version' }).click();
await page.waitForTimeout(1500);
console.log(
  'stale while open:',
  await form.locator('p.error[role=alert]').textContent(),
  '| save disabled:',
  await page.getByRole('button', { name: 'Save new version' }).isDisabled(),
  '| form still open:',
  await form.count(),
);
await form.locator('p.error').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${out}/06-stale-while-open.png` });
await browser.close();
