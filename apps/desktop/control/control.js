// Setup/status window for the installed studio (ADR-0041). Talks only to the app's own
// scoped commands; renders every value as text.
const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
const $ = (id) => document.getElementById(id);
let state = null;
let detected = false;
let prefsFilled = false;

function prefs(container, name) {
  const node = $('prefs-template').content.cloneNode(true);
  for (const r of node.querySelectorAll('input[type=radio]')) r.name = name;
  container.querySelector('.prefs').replaceChildren(node);
}
prefs($('prefs-setup'), 'close-setup');
prefs($('prefs-running'), 'close-running');
$('prefs-setup').querySelector('input[value=quit]').checked = true;

function readPrefs(container) {
  return {
    close_behavior:
      container.querySelector('input[type=radio]:checked')?.value ?? 'quit',
    launch_at_login: container.querySelector('.login').checked,
  };
}
function showError(e) {
  $('error').hidden = !e;
  $('error').textContent = e ? String(e) : '';
}
async function act(button, fn) {
  showError('');
  const all = document.querySelectorAll('button');
  for (const b of all) b.disabled = true;
  try {
    return await fn();
  } catch (e) {
    showError(e);
  } finally {
    for (const b of all) b.disabled = false;
    await refresh();
  }
}
function source() {
  return {
    host: $('src-host').value.trim(),
    port: Number($('src-port').value),
    database: $('src-db').value.trim(),
    user: $('src-user').value.trim(),
    password: $('src-password').value,
    password_file: $('src-password-file').value.trim(),
    products_root: $('src-products').value.trim(),
  };
}

async function detect() {
  const list = await invoke('studio_detect_postgres');
  const box = $('pg-list');
  box.replaceChildren();
  for (const c of list) {
    const p = document.createElement('p');
    p.className = 'small';
    p.textContent = c.ok
      ? `✓ ${c.path} — PostgreSQL ${c.version}`
      : `✗ ${c.path} — ${c.error}`;
    box.append(p);
  }
  const first = list.find((c) => c.ok);
  if (first && !$('pg-bin').value) $('pg-bin').value = first.path;
}

function render(s) {
  state = s;
  $('phase').textContent = s.phase.replace('_', ' ');
  $('title').textContent = s.title;
  $('detail').textContent = s.detail;
  $('home').textContent = s.home;
  $('setup').hidden = s.phase !== 'setup';
  $('migrate').hidden = s.phase !== 'needs_migration';
  $('running').hidden = s.phase !== 'running';
  $('retry').hidden = s.action !== 'retry';
  if (s.migration)
    $('approve-migration').textContent =
      `Back up and upgrade the database (layout ${s.migration.current} → ${s.migration.expected})`;
  $('sign-in').hidden = s.signed_in;
  $('sign-out').hidden = !s.signed_in;
  $('signin-state').textContent = s.signed_in
    ? 'Signed in as the local owner. The sign-in is kept on this computer, protected by Windows, until it expires or you sign out.'
    : 'Not signed in. Sign-in uses a code that only this app knows; it is never shown or sent anywhere else.';
  if (s.phase === 'setup' && !detected) {
    detected = true;
    detect().catch(showError);
  }
  if (s.config && !s.config.error && !prefsFilled) {
    prefsFilled = true;
    const box = $('prefs-running');
    box.querySelector(`input[value=${s.config.close_behavior}]`).checked = true;
    box.querySelector('.login').checked = s.config.launch_at_login;
  }
  const facts = $('facts');
  facts.replaceChildren();
  const add = (k, v) => {
    if (v === undefined || v === null || v === '') return;
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = String(v);
    facts.append(dt, dd);
  };
  if (s.config && !s.config.error) {
    add('Database', s.config.database.label);
    add('Products', s.config.products_root);
    add('Studio folder', s.home);
    const o = s.config.origin ?? {};
    if (o.kind === 'adopted')
      add(
        'Records',
        `Adopted from ${o.from} on ${o.adopted_at}, verified; backup in ${o.backup_dir}`,
      );
    else if (o.kind === 'new_empty')
      add('Records', `New studio created ${o.created_at}`);
    else if (o.kind === 'external')
      add('Records', `Connected ${o.connected_at}`);
  }
  $('log').replaceChildren(
    ...s.log.map((l) => {
      const li = document.createElement('li');
      li.textContent = l;
      return li;
    }),
  );
  const b = s.bundle;
  $('build').textContent = b
    ? `Build ${String(b.source_commit).slice(0, 12)}${b.source_dirty ? ' (with uncommitted changes)' : ''}, Node ${b.node_version}, built ${b.built_at}`
    : '';
}
async function refresh() {
  try {
    render(await invoke('studio_state'));
  } catch (e) {
    showError(e);
  }
}

$('check-source').addEventListener('click', () =>
  act($('check-source'), async () => {
    const r = await invoke('studio_inspect_source', { source: source() });
    const out = $('source-result');
    if (!r.reachable) out.textContent = `Not reachable: ${r.error}`;
    else
      out.textContent = `Reachable. Database layout ${r.applied} (this app uses ${r.expected}). Workspaces: ${
        r.workspaces.map((w) => `${w.name} (${w.record_mode})`).join(', ') ||
        'none'
      }.`;
  }),
);
$('run-setup').addEventListener('click', () =>
  act($('run-setup'), async () => {
    const kind = document.querySelector('input[name=kind]:checked').value;
    const confirmText =
      kind === 'new'
        ? 'Create a new, empty studio? Your existing studio will not be imported.'
        : kind === 'adopt'
          ? 'Adopt the studio shown above? It is copied and verified; the original is not changed.'
          : 'Connect directly to the database above? The app will not start or stop it.';
    if (!window.confirm(confirmText)) return;
    await invoke('studio_setup', {
      request: {
        kind,
        pg_bin: $('pg-bin').value.trim(),
        source: kind === 'new' ? null : source(),
        ...readPrefs($('prefs-setup')),
      },
    });
  }),
);
$('approve-migration').addEventListener('click', () =>
  act($('approve-migration'), () => invoke('studio_migrate')),
);
$('open-studio').addEventListener('click', () =>
  act($('open-studio'), () => invoke('studio_open')),
);
$('sign-in').addEventListener('click', () =>
  act($('sign-in'), () => invoke('studio_sign_in')),
);
$('sign-out').addEventListener('click', () =>
  act($('sign-out'), () => invoke('studio_sign_out')),
);
$('save-prefs').addEventListener('click', () =>
  act($('save-prefs'), () => {
    const p = readPrefs($('prefs-running'));
    // Tauri maps command arguments from camelCase.
    return invoke('studio_preferences', {
      closeBehavior: p.close_behavior,
      launchAtLogin: p.launch_at_login,
    });
  }),
);
$('retry').addEventListener('click', () =>
  act($('retry'), () => invoke('studio_retry')),
);
$('logs').addEventListener('click', () =>
  act($('logs'), () => invoke('studio_open_logs')),
);
$('quit').addEventListener('click', () =>
  act($('quit'), () => invoke('studio_quit')),
);
for (const r of document.querySelectorAll('input[name=kind]'))
  r.addEventListener('change', () => {
    $('source').hidden =
      document.querySelector('input[name=kind]:checked').value === 'new';
  });

refresh();
setInterval(refresh, 700);
