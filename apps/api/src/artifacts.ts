import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import {
  ContractError,
  RegisterArtifactRequestSchema,
  RunInputSchema,
  TerminalStartRequestSchema,
  TerminalStopRequestSchema,
  parse,
  type ArtifactDetail,
  type PreviewRun,
} from '@creator/contracts';
import type { ArtifactStore, CommandContext, PreviewGuide } from '@creator/db';
import type { ArtifactSupervisor, TerminalSupervisor } from '@creator/executor';

type Send = (
  status: number,
  value: unknown,
  mutated: boolean,
) => Promise<boolean>;

/**
 * Owner artifact routes on the management API. Every byte read re-hashes the stored package
 * against the indexed manifest; downloads and starts recheck owner access at that moment.
 */
export async function artifactRoutes(o: {
  store: ArtifactStore;
  artifacts: ArtifactSupervisor;
  terminals: TerminalSupervisor;
  /** Terminal sessions open a window on the studio's own computer: local studios only. */
  localStudio: boolean;
  previewOrigin: () => string | null;
  ctx: CommandContext;
  ws: string;
  collection: string;
  item: string | undefined;
  action: string | undefined;
  method: string;
  url: URL;
  res: ServerResponse;
  body: () => Promise<unknown>;
  send: Send;
}): Promise<boolean> {
  const { store, artifacts, ctx, ws, item, action, method, send } = o;
  if (o.collection === 'artifacts') {
    if (!item && method === 'GET')
      return send(200, await store.listArtifacts(ctx, ws), false);
    if (!item && method === 'POST') {
      const req = parse(RegisterArtifactRequestSchema, await o.body());
      // Read and re-hash the local manifest and archive; the request carries only identities.
      const { manifest, manifest_sha256 } = await artifacts.manifest(
        req.product_id,
        req.artifact_id,
        req.manifest_sha256,
      );
      await artifacts.open(req.product_id, req.artifact_id, manifest_sha256);
      return send(
        201,
        await store.registerArtifact(ctx, ws, manifest, manifest_sha256),
        true,
      );
    }
    if (item && !action && method === 'GET') {
      const a = await store.artifactActivity(ctx, ws, item);
      let integrity: ArtifactDetail['integrity'];
      try {
        await artifacts.open(
          a.manifest.product_id,
          a.summary.id,
          a.summary.manifest_sha256,
        );
        integrity = {
          checked_at: new Date().toISOString(),
          ok: true,
          detail: 'Manifest and archive re-hashed and match.',
        };
      } catch (e) {
        integrity = {
          checked_at: new Date().toISOString(),
          ok: false,
          detail: (e instanceof Error ? e.message : String(e)).slice(0, 500),
        };
      }
      return send(
        200,
        {
          artifact: a.summary,
          manifest: a.manifest,
          previews: a.previews,
          feedback: a.feedback,
          integrity,
        } satisfies ArtifactDetail,
        false,
      );
    }
    if (item && action === 'manifest' && method === 'GET') {
      const a = await store.artifactRecord(ctx, ws, item, true);
      const expected = o.url.searchParams.get('sha256');
      if (expected !== a.summary.manifest_sha256)
        throw new ContractError(
          'VERSION_CONFLICT',
          'Manifest export must name the current catalog hash.',
        );
      const bytes = await artifacts.exportManifest(
        a.manifest.product_id,
        item,
        expected,
      );
      o.res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': String(bytes.length),
        'X-Content-SHA256': expected,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'attachment; filename="manifest.json"',
      });
      o.res.end(bytes);
      return true;
    }
    if (item && action === 'download' && method === 'GET') {
      const a = await store.artifactRecord(ctx, ws, item, true);
      const expected = o.url.searchParams.get('sha256');
      if (expected !== a.summary.manifest_sha256)
        throw new ContractError(
          'VERSION_CONFLICT',
          'Stale version: download must name the current manifest sha256.',
        );
      const { archive } = await artifacts.open(
        a.manifest.product_id,
        a.summary.id,
        a.summary.manifest_sha256,
      );
      await store.recordDownload(ctx, ws, a.summary.id);
      o.res.writeHead(200, {
        'Content-Type': 'application/x-tar',
        'Content-Length': String(archive.length),
        'Content-Disposition': `attachment; filename="creator-${a.summary.commit.slice(0, 10)}-${a.summary.id.slice(0, 8)}.tar"`,
        'X-Content-SHA256': a.manifest.package.sha256,
        'X-Manifest-SHA256': a.summary.manifest_sha256,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      o.res.end(archive);
      return true;
    }
    if (item && action === 'compare' && method === 'GET') {
      const other = o.url.searchParams.get('with');
      if (!other)
        throw new ContractError('INVALID_CONTRACT', 'compare needs ?with=');
      return send(
        200,
        await store.compareArtifacts(ctx, ws, item, other),
        false,
      );
    }
    // Feedback on one artifact without the detail read's archive re-hash: the what's-next
    // line reads this for the newest package every time it refreshes.
    if (item && action === 'feedback' && method === 'GET')
      return send(
        200,
        (await store.artifactActivity(ctx, ws, item)).feedback,
        false,
      );
    if (item && action === 'feedback' && method === 'POST')
      return send(
        201,
        await store.submitFeedback(ctx, ws, item, await o.body()),
        true,
      );
    if (item && action === 'previews' && method === 'POST') {
      const { preview, ticket, record } = await store.beginPreview(
        ctx,
        ws,
        item,
        await o.body(),
      );
      let state: 'ready' | 'failed' | 'blocked' = 'blocked';
      let readiness: Record<string, unknown>;
      try {
        // Rechecks the bytes and starts the exact exported package in the isolated worker.
        const r = await artifacts.readiness(
          record.manifest.product_id,
          record.summary.id,
          record.summary.manifest_sha256,
          ctx.actorId,
        );
        state = r.ready
          ? 'ready'
          : ['blocked', 'cleanup_required', 'lost'].includes(r.execution.state)
            ? 'blocked'
            : 'failed';
        readiness = {
          case: record.manifest.startup.readiness_case,
          execution_id: r.execution.id,
          execution_state: r.execution.state,
          exit_code: r.execution.exit_code,
          reason: r.execution.reason,
          input_hash: r.execution.input_hash,
        };
      } catch (e) {
        readiness = {
          case: record.manifest.startup.readiness_case,
          execution_id: null,
          reason: (e instanceof Error ? e.message : String(e)).slice(0, 2000),
        };
        if (e instanceof ContractError && e.code === 'EVIDENCE_MISMATCH')
          state = 'failed';
      }
      const settled = await store.settlePreview(
        ctx,
        ws,
        preview.id,
        state,
        readiness,
      );
      const origin = o.previewOrigin();
      return send(
        201,
        {
          preview: settled,
          url:
            settled.state === 'ready' && origin
              ? `${origin}/preview/${settled.id}?ticket=${ticket}`
              : null,
        },
        true,
      );
    }
  }
  if (o.collection === 'artifacts' && item && action === 'terminals') {
    if (method === 'GET') {
      const a = await store.artifactRecord(ctx, ws, item, true);
      return send(
        200,
        await o.terminals.list(
          a.manifest.product_id,
          ctx.actorId,
          a.summary.id,
        ),
        false,
      );
    }
    if (method === 'POST') {
      const req = parse(TerminalStartRequestSchema, await o.body());
      if (!o.localStudio)
        throw new ContractError(
          'LIVE_DISABLED',
          'A hosted studio cannot open a terminal on your computer. Download the package instead.',
        );
      const a = await store.artifactRecord(ctx, ws, item, true);
      if (req.manifest_sha256 !== a.summary.manifest_sha256)
        throw new ContractError(
          'VERSION_CONFLICT',
          'Stale version: the terminal must name the current manifest sha256.',
        );
      if (a.summary.state !== 'verified')
        throw new ContractError(
          'INVALID_TRANSITION',
          'Only a verified package can run in a terminal.',
        );
      // Re-hashes the manifest and archive and reads the exact package bytes.
      const { manifest, files } = await artifacts.open(
        a.manifest.product_id,
        a.summary.id,
        a.summary.manifest_sha256,
      );
      if (manifest.availability.runnable_demo.state !== 'available')
        throw new ContractError(
          'INVALID_TRANSITION',
          manifest.availability.runnable_demo.reason,
        );
      const session = await o.terminals.open({
        productId: manifest.product_id,
        artifactId: a.summary.id,
        manifestSha256: a.summary.manifest_sha256,
        packageSha256: manifest.package.sha256,
        taskId: manifest.task.id,
        commit: manifest.repository.commit,
        files,
        owner: ctx.actorId,
        args: req.args,
      });
      await store.recordTerminal(ctx, ws, item, 'artifact.terminal.started', {
        session_id: session.id,
        state: session.state,
        command: session.command,
        manifest_sha256: session.manifest_sha256,
        policy_hash: session.policy_hash,
      });
      return send(201, session, true);
    }
  }
  if (
    o.collection === 'terminals' &&
    item &&
    action === 'stop' &&
    method === 'POST'
  ) {
    const req = parse(TerminalStopRequestSchema, await o.body());
    const a = await store.artifactRecord(ctx, ws, req.artifact_id, true);
    const found = await o.terminals
      .status(a.manifest.product_id, item)
      .catch(() => null);
    if (!found || found.artifact_id !== a.summary.id)
      throw new ContractError(
        'NOT_FOUND',
        'No such terminal for this package.',
      );
    const session = await o.terminals.stop(
      a.manifest.product_id,
      item,
      ctx.actorId,
    );
    await store.recordTerminal(
      ctx,
      ws,
      req.artifact_id,
      'artifact.terminal.stopped',
      { session_id: session.id, state: session.state },
    );
    return send(200, session, true);
  }
  if (
    o.collection === 'previews' &&
    item &&
    action === 'stop' &&
    method === 'POST'
  )
    return send(
      200,
      await store.stopPreview(ctx, ws, item, await o.body()),
      true,
    );
  if (o.collection === 'feedback' && item && method === 'POST') {
    if (action === 'decide')
      return send(
        200,
        await store.decideFeedback(ctx, ws, item, await o.body()),
        true,
      );
    if (action === 'revision')
      return send(
        200,
        await store.reviseFromFeedback(ctx, ws, item, await o.body()),
        true,
      );
  }
  return false;
}

const PREVIEW_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
const html = (v: unknown) =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const STYLE = `body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#f6f5f2;color:#1d1d1b}
main{max-width:46rem;margin:0 auto;padding:1.5rem 1rem}
.banner{background:#1d1d1b;color:#fff;padding:.6rem 1rem;font-size:.85rem}
dl{display:grid;grid-template-columns:max-content 1fr;gap:.25rem 1rem;font-size:.85rem}
dt{color:#555}dd{margin:0;word-break:break-all}
label{display:block;margin:.75rem 0 .25rem;font-weight:600}
textarea,input{width:100%;box-sizing:border-box;font:13px ui-monospace,monospace;padding:.4rem}
button{margin-top:.75rem;padding:.45rem 1rem;font-weight:600}
pre{background:#fff;border:1px solid #ccc;padding:.75rem;white-space:pre-wrap;min-height:3rem}
.error{color:#9b1c1c}
.muted{color:#666}
.label{margin:.5rem 0 .2rem;font-size:.85rem;font-weight:600}
.example{border:1px solid #ccc;border-radius:4px;padding:.5rem .75rem;margin:.5rem 0}
.example summary{cursor:pointer;font-weight:600}
.example pre{min-height:0;margin:0}
.flows{padding-left:1.2rem}.flows ol{margin:.2rem 0 .5rem}
code{font:13px ui-monospace,monospace}
@media (prefers-color-scheme:dark){body{background:#161615;color:#ecebe7}pre,textarea,input{background:#222;color:#ecebe7;border-color:#444}dt,.muted{color:#aaa}.example{border-color:#444}}`;
const SCRIPT = `const form=document.getElementById('run');const out=document.getElementById('out');const meta=document.getElementById('meta');
form.addEventListener('submit',async(e)=>{e.preventDefault();const b=form.querySelector('button');b.disabled=true;out.textContent='Running the exact package in the isolated worker…';meta.textContent='';
const args=document.getElementById('args').value.split('\\n').filter((s)=>s.length);const stdin=document.getElementById('stdin').value;
try{const r=await fetch(location.pathname+'/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({args,stdin})});const v=await r.json();
if(!r.ok){out.textContent='Refused: '+(v.error?v.error.message:r.status);out.className='error';}else{out.className='';out.textContent=v.stdout||'(no output)';meta.textContent='Exit '+v.exit_code+' · '+v.state+(v.reason?' · '+v.reason:'')+' · run '+v.runs_used+' of '+v.max_runs;}}
catch(err){out.textContent='Request failed';out.className='error';}finally{b.disabled=false;}});
for(const x of document.querySelectorAll('button[data-example]'))x.addEventListener('click',()=>{document.getElementById('args').value=JSON.parse(x.dataset.args).join('\\n');document.getElementById('stdin').value=x.dataset.stdin;form.querySelector('button[type=submit]').focus();});`;

/** One argument as it would be typed in a POSIX shell, for display only. */
const shellWord = (v: string) =>
  /^[A-Za-z0-9_@%+=:,./-]+$/.test(v) ? v : `'${v.replaceAll("'", `'\\''`)}'`;
const placeholder = (v: string | undefined) =>
  v ? ` placeholder="${html(`For example:\n${v}`)}"` : '';
const block = (label: string, v: string) =>
  `<p class="label">${label}</p><pre>${v ? html(v) : '<span class="muted">(empty)</span>'}</pre>`;

/**
 * F16: how to use the package and what to type, from the frozen spec it was built from.
 * Only visible cases are shown; held-out cases stay hidden, as they are from the build roles.
 */
function usage(command: string[], guide: PreviewGuide | null) {
  const intro = `<h2>How to use it</h2><p>Each run starts <code>${html(command.join(' '))}</code> with the arguments below and sends the standard input all at once, then shows what the program printed. Runs are not interactive: the program cannot wait for a key press.</p>`;
  if (!guide)
    return `${intro}<p class="muted">The spec version this package was built from is not available, so no usage steps or examples can be shown.</p>`;
  const flows = guide.flows.length
    ? `<h3>What it does</h3><ul class="flows">${guide.flows
        .map(
          (f) =>
            `<li><strong>${html(f.name)}</strong><ol>${f.steps.map((x) => `<li>${html(x)}</li>`).join('')}</ol></li>`,
        )
        .join('')}</ul>`
    : '';
  const examples = guide.examples.length
    ? `<h3>${guide.examples.length === 1 ? 'Example' : 'Examples'} from the spec</h3>${guide.examples
        .map(
          (x, i) =>
            `<details class="example"${i === 0 ? ' open' : ''}><summary>${html(x.check_key)}: ${html(x.statement)}</summary>
${block('Command line', [...command, ...x.args].map(shellWord).join(' '))}${block('Standard input', x.stdin)}${block(`Expected output (exit ${x.exit_code})`, x.stdout)}
<button type="button" data-example data-args="${html(JSON.stringify(x.args))}" data-stdin="${html(x.stdin)}">Use this example</button></details>`,
        )
        .join('')}${
        guide.more_examples
          ? `<p class="muted">${guide.more_examples} more visible ${guide.more_examples === 1 ? 'case is' : 'cases are'} in the spec.</p>`
          : ''
      }`
    : '<p class="muted">The spec has no visible example case for this task.</p>';
  const hidden = guide.held_out_hidden
    ? '<p class="muted">Held-out cases are not shown here; QA uses them to check the build.</p>'
    : '';
  return `${intro}${flows}${examples}${hidden}`;
}

function page(
  res: ServerResponse,
  status: number,
  title: string,
  body: string,
) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': PREVIEW_CSP,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  res.end(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(title)}</title><link rel="stylesheet" href="/preview-assets/preview.css"></head><body><div class="banner">Creator Agent private preview · separate origin · the generated program runs only in the isolated worker</div><main>${body}</main></body></html>`,
  );
}
const statusOf: Partial<Record<ContractError['code'], number>> = {
  NOT_FOUND: 404,
  ACCESS_DENIED: 403,
  EXPIRED: 410,
  LIMIT_EXCEEDED: 429,
  EVIDENCE_MISMATCH: 409,
  INVALID_TRANSITION: 409,
  ORIGIN_DENIED: 403,
};

/**
 * The preview origin. It serves only studio-authored HTML/JS and never reads management
 * cookies; generated code runs in the isolated worker and only its text output comes back.
 */
export function createPreviewServer(
  store: ArtifactStore | null,
  artifacts: ArtifactSupervisor,
  /** X06: a hosted deployment's public preview origin (its own host behind the proxy). */
  publicOrigin: string | null = null,
): Server {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const port = req.socket.localPort;
      const self = publicOrigin ?? `http://127.0.0.1:${port}`;
      if (req.headers.host !== new URL(self).host)
        throw new ContractError(
          'ORIGIN_DENIED',
          publicOrigin
            ? 'Use the public preview origin.'
            : 'Use the 127.0.0.1 preview origin.',
        );
      if (!store)
        throw new ContractError(
          'NOT_FOUND',
          'Previews need PostgreSQL records.',
        );
      const url = new URL(req.url ?? '/', self);
      if (
        req.method === 'GET' &&
        url.pathname === '/preview-assets/preview.js'
      ) {
        res.writeHead(200, {
          'Content-Type': 'text/javascript; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        });
        return res.end(SCRIPT);
      }
      if (
        req.method === 'GET' &&
        url.pathname === '/preview-assets/preview.css'
      ) {
        res.writeHead(200, {
          'Content-Type': 'text/css; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        });
        return res.end(STYLE);
      }
      const m = /^\/preview\/([0-9a-f-]{36})(\/run)?$/.exec(url.pathname);
      if (!m) throw new ContractError('NOT_FOUND', 'Not found.');
      const id = m[1]!;
      const cookie = `creator_preview_${id.replaceAll('-', '')}`;
      const session = (req.headers.cookie ?? '')
        .split(';')
        .map((p) => p.trim().split('='))
        .find(([k]) => k === cookie)?.[1];
      const ticket = url.searchParams.get('ticket');
      if (req.method === 'GET' && !m[2] && ticket) {
        const s = await store.openPreview(id, ticket);
        res.writeHead(303, {
          'Set-Cookie': `${cookie}=${s}; Path=/preview/${id}; HttpOnly; SameSite=Strict`,
          Location: `/preview/${id}`,
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        });
        return res.end();
      }
      if (!session)
        throw new ContractError(
          'ACCESS_DENIED',
          'Open this preview from the studio gallery.',
        );
      if (req.method === 'GET' && !m[2]) {
        const a = await store.previewAccess(id, session, false);
        const mf = a.record.manifest;
        const first = a.guide?.examples[0];
        return page(
          res,
          200,
          'Private preview',
          `<h1>Private preview</h1>${
            mf.toolchain.backend === 'wsl2-bwrap-systemd'
              ? ''
              : `<p class="error">Not isolation evidence: this package runs on “${html(mf.toolchain.backend)}”, not the reviewed isolated worker.</p>`
          }
<dl><dt>Artifact</dt><dd>${html(mf.id)}</dd><dt>Commit</dt><dd>${html(mf.repository.commit)}</dd>
<dt>Spec</dt><dd>v${html(mf.spec.version)}</dd><dt>Manifest sha256</dt><dd>${html(a.preview.manifest_sha256)}</dd>
<dt>Expires</dt><dd>${html(a.preview.expires_at)}</dd><dt>Runs</dt><dd>${html(a.preview.runs_used)} of ${html(a.preview.max_runs)}</dd>
<dt>Command</dt><dd>${html(mf.startup.command.join(' '))} [arguments]</dd></dl>
${usage(mf.startup.command, a.guide)}
<form id="run"><label for="args">Arguments, one per line</label><textarea id="args" rows="3"${placeholder(first?.args.join('\n'))}></textarea>
<label for="stdin">Standard input</label><textarea id="stdin" rows="3"${placeholder(first?.stdin)}></textarea>
<button type="submit">Run in isolated worker</button></form>
<h2>Output</h2><pre id="out" aria-live="polite">Not run yet.</pre><p id="meta"></p>
<script src="/preview-assets/preview.js"></script>`,
        );
      }
      if (req.method === 'POST' && m[2]) {
        if (req.headers.origin !== self)
          throw new ContractError(
            'ORIGIN_DENIED',
            'Preview runs come only from this preview page.',
          );
        if (req.headers['content-type']?.split(';')[0] !== 'application/json')
          throw new ContractError(
            'INVALID_CONTRACT',
            'Expected application/json.',
          );
        // Collect bytes and decode once, so a multibyte character split across chunks survives.
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req as AsyncIterable<Buffer>) {
          size += chunk.length;
          if (size > 16384)
            throw new ContractError('BODY_TOO_LARGE', 'Request too large.');
          chunks.push(chunk);
        }
        const raw = Buffer.concat(chunks).toString('utf8');
        const input = parse(RunInputSchema, JSON.parse(raw || 'null'));
        const a = await store.previewAccess(id, session, true);
        const e = await artifacts.start(
          a.product_id,
          a.record.summary.id,
          a.preview.manifest_sha256,
          a.actor_id,
          input,
        );
        await store.recordPreviewRun(a.actor_id, a.workspace_id, id, {
          execution_id: e.id,
          state: e.state,
          exit_code: e.exit_code,
        });
        const run: PreviewRun = {
          preview_id: id,
          execution_id: e.id,
          state: e.state,
          stdout: e.log,
          exit_code: e.exit_code,
          reason: e.reason,
          runs_used: a.preview.runs_used,
          max_runs: a.preview.max_runs,
        };
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        return res.end(JSON.stringify(run));
      }
      throw new ContractError('NOT_FOUND', 'Not found.');
    })().catch((error: unknown) => {
      const e =
        error instanceof ContractError
          ? error
          : new ContractError('INTERNAL_ERROR', 'Preview failure.');
      if (res.headersSent || res.destroyed) return;
      const status =
        statusOf[e.code] ?? (e.code === 'INTERNAL_ERROR' ? 500 : 400);
      if ((req.method ?? 'GET') === 'GET' && !req.url?.endsWith('/run'))
        return page(
          res,
          status,
          'Preview unavailable',
          `<h1>Preview unavailable</h1><p class="error">${html(e.message)}</p>`,
        );
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ error: { code: e.code, message: e.message } }));
    });
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return server;
}
