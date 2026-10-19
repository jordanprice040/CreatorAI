import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ContractError, id, parse, type SessionInfo } from '@creator/contracts';
import type { DesktopJobStore } from '@creator/db';
import type { ArtifactSupervisor } from '@creator/executor';
import { canonicalHash } from '@creator/domain';

type Auth = {
  desktopCookie: { name: string; secure: boolean };
  require(req: IncomingMessage, mutation: boolean): Promise<SessionInfo>;
  sessionHash(req: IncomingMessage): string;
};

export async function desktopRoutes(o: {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  store: DesktopJobStore;
  artifacts: ArtifactSupervisor;
  auth: Auth;
  body: () => Promise<unknown>;
  send: (status: number, body: unknown) => void;
}) {
  const { req, res, url, store, auth, body, send } = o;
  const path = url.pathname.slice('/api/desktop/'.length);
  if (path === 'approve' && req.method === 'GET') {
    parse(id, url.searchParams.get('id'));
    const nonce = randomBytes(18).toString('base64');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    });
    res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Approve Creator Agent device</title>
<h1>Approve Creator Agent device</h1><p id="details">Loading request…</p>
<p>Continue only if you started this request. Compare the code with your desktop window or worker terminal.</p>
<p>Desktop login grants your current studio session access. A worker with artifact.run may accept exact owner-submitted artifact jobs in the reviewed offline WSL sandbox. Presence-only workers cannot execute jobs.</p>
<button id="approve" disabled>Approve this device</button><p id="status" role="status"></p>
<a href="/">Open studio to sign in, then return and reload this page</a>
<script nonce="${nonce}">
const requestId = new URL(location.href).searchParams.get('id');
const button = document.getElementById('approve'); const status = document.getElementById('status');
let session;
async function read(path, init) { const r = await fetch('/api/'+path, init); const v=await r.json(); if(!r.ok) throw Error(v.error?.message || 'Request failed'); return v; }
(async()=>{ try { session=await read('auth/session'); const c=await read('desktop/challenges/'+requestId); document.getElementById('details').textContent=c.label+' — '+c.kind+' — capabilities '+c.capabilities.join(', ')+' — code '+c.comparison_code+' — expires '+c.expires_at; button.disabled=false; } catch(e) { status.textContent=e.message; } })();
button.onclick=async()=>{ button.disabled=true; try { await read('desktop/challenges/'+requestId+'/approve', { method:'POST', headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf_token},body:'{}' }); status.textContent='Approved. Return to your desktop or worker terminal.'; } catch(e) { status.textContent=e.message; button.disabled=false; } };
</script></html>`);
    return;
  }
  if (path === 'challenges' && req.method === 'POST') {
    send(201, await store.beginDesktop(await body()));
    return;
  }
  const challenge = /^challenges\/([^/]+)(?:\/(approve|claim))?$/.exec(path);
  if (challenge) {
    const challengeId = parse(id, challenge[1]);
    if (challenge[2] === 'claim' && req.method === 'POST') {
      const claimed = await store.claimDesktop(challengeId, await body());
      send(
        200,
        claimed.state === 'paired' && claimed.device.kind === 'desktop_login'
          ? { ...claimed, cookie: auth.desktopCookie }
          : claimed,
      );
      return;
    }
    const session = await auth.require(req, req.method !== 'GET');
    if (!challenge[2] && req.method === 'GET') {
      send(
        200,
        await store.desktopChallenge(
          { actorId: session.actor_id },
          challengeId,
        ),
      );
      return;
    }
    if (challenge[2] === 'approve' && req.method === 'POST') {
      send(
        200,
        await store.approveDesktop(
          { actorId: session.actor_id },
          challengeId,
          auth.sessionHash(req),
        ),
      );
      return;
    }
  }
  if (path === 'heartbeat' && req.method === 'POST') {
    const token = req.headers.authorization?.match(
      /^Bearer ([A-Za-z0-9_-]{43})$/,
    )?.[1];
    if (!token)
      throw new ContractError(
        'UNAUTHENTICATED',
        'Worker bearer credential required.',
      );
    send(200, await store.heartbeatDesktop(token, await body()));
    return;
  }
  const workerJob = /^jobs(?:\/([^/]+)\/(start|check|finish))?$/.exec(path);
  if (workerJob && req.method === 'POST') {
    const token = req.headers.authorization?.match(
      /^Bearer ([A-Za-z0-9_-]{43})$/,
    )?.[1];
    if (!token)
      throw new ContractError(
        'UNAUTHENTICATED',
        'Worker bearer credential required.',
      );
    if (!workerJob[1]) send(200, await store.leaseDesktopJob(token));
    else if (workerJob[2] === 'finish')
      send(
        200,
        await store.finishDesktopJob(
          token,
          parse(id, workerJob[1]),
          await body(),
        ),
      );
    else
      send(
        200,
        await store.checkDesktopJob(
          token,
          parse(id, workerJob[1]),
          await body(),
          workerJob[2] === 'start',
        ),
      );
    return;
  }
  const session = await auth.require(req, req.method !== 'GET');
  const ownerJob = /^jobs\/([^/]+)\/(cancel|reconcile)$/.exec(path);
  if (ownerJob && req.method === 'POST') {
    const ctx = { actorId: session.actor_id };
    const jobId = parse(id, ownerJob[1]);
    if (ownerJob[2] === 'cancel') {
      send(200, await store.cancelDesktopJob(ctx, jobId));
      return;
    }
    const job = await store.desktopJobForOwner(ctx, jobId);
    if (job.state !== 'reconciling' || !job.execution_id)
      throw new ContractError(
        'INVALID_TRANSITION',
        'Only an uncertain bound execution can be reconciled.',
      );
    const local = await o.artifacts.executor.reconcile(
      job.product_id,
      job.execution_id,
      job.owner_id,
    );
    if (
      ['running', 'cleanup_required'].includes(local.state) ||
      local.environment.backend !== 'wsl2-bwrap-systemd' ||
      local.environment.package_sha256 !== job.archive_sha256 ||
      local.product_id !== job.product_id
    )
      throw new ContractError(
        'EVIDENCE_MISMATCH',
        'Local worker stop or artifact identity could not be verified.',
      );
    send(
      200,
      await store.reconcileDesktopJob(
        ctx,
        jobId,
        local.id,
        canonicalHash(local),
      ),
    );
    return;
  }
  const jobs = /^devices\/([^/]+)\/jobs$/.exec(path);
  if (jobs) {
    const deviceId = parse(id, jobs[1]);
    if (req.method === 'GET') {
      send(
        200,
        await store.listDesktopJobs({ actorId: session.actor_id }, deviceId),
      );
      return;
    }
    if (req.method === 'POST') {
      send(
        201,
        await store.queueDesktopJob(
          { actorId: session.actor_id },
          deviceId,
          await body(),
        ),
      );
      return;
    }
  }
  if (path === 'devices' && req.method === 'GET') {
    send(200, await store.desktopDevices({ actorId: session.actor_id }));
    return;
  }
  const control = /^devices\/([^/]+)\/control$/.exec(path);
  if (control && req.method === 'POST') {
    send(
      200,
      await store.controlDesktop(
        { actorId: session.actor_id },
        parse(id, control[1]),
        await body(),
      ),
    );
    return;
  }
  throw new ContractError('NOT_FOUND', 'Desktop route not found.');
}
