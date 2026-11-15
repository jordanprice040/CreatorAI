import { randomBytes, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  DesktopChallengeSchema,
  DesktopDeviceSchema,
  DesktopCapabilitySchema,
  DesktopJobSchema,
  z,
} from '../../packages/contracts/dist/index.js';

const ClaimSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('pending') }),
  z.strictObject({
    state: z.literal('paired'),
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    device: DesktopDeviceSchema,
  }),
]);
const HeartbeatSchema = z.strictObject({
  device: DesktopDeviceSchema,
  lease: z
    .strictObject({
      workspace_id: z.uuid(),
      capabilities: z.array(DesktopCapabilitySchema),
      fence: z.number().int(),
      expires_at: z.iso.datetime(),
      purpose: z.literal('presence_only'),
    })
    .nullable(),
});

/**
 * Where the owner approves a pairing: the web app in front of the API. ADR-0108 (review 1
 * L-2): locally the installed app's API (4310) pairs with its window (5173) and the dev API
 * (4410) with the dev web app (5273); any other local API is linked directly unless
 * CREATOR_WEB_URL (a loopback http origin) names its web app.
 */
export function approvalOrigin(apiOrigin, hosted, webUrl) {
  if (hosted) return new URL(webUrl ?? apiOrigin).origin;
  if (webUrl !== undefined) {
    const web = new URL(webUrl);
    if (web.protocol !== 'http:' || web.hostname !== '127.0.0.1')
      throw new Error('CREATOR_WEB_URL must be an http://127.0.0.1 origin.');
    return web.origin;
  }
  const api = new URL(apiOrigin);
  const web = { 4310: 5173, 4410: 5273 }[api.port];
  // Any other port (a moved dev API, a test): the API answers the approval route itself.
  return web ? `http://127.0.0.1:${web}` : api.origin;
}

/**
 * Control origin for this worker. The default is the local API on loopback. A hosted
 * control plane (X06) is accepted only when explicitly requested and only over https with
 * certificate verification; the worker still connects outbound only and receives no
 * inbound connections.
 */
export function workerClient(
  origin = 'http://127.0.0.1:4310',
  { hosted = false } = {},
) {
  const url = new URL(origin);
  if (
    (hosted
      ? url.protocol !== 'https:'
      : url.protocol !== 'http:' || url.hostname !== '127.0.0.1') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error(
      hosted
        ? 'A hosted control origin must be a bare https origin.'
        : 'This worker supports an explicit local loopback control origin only (set CREATOR_CONTROL=hosted for an https hosted control plane).',
    );
  async function post(path, body, schema, token) {
    const r = await fetch(`${url.origin}/api/desktop/${path}`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    // No credentials in error text, stdout, URLs or files.
    if (!r.ok) {
      await r.body?.cancel();
      throw new Error(`Worker control returned HTTP ${r.status}`);
    }
    const reader = r.body?.getReader();
    if (!reader) throw new Error('Empty worker response');
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 65536) throw new Error('Worker response limit exceeded');
        chunks.push(Buffer.from(value));
      }
      return schema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  return {
    async begin(workspaceId, label, capabilities = ['artifact.verify']) {
      const proof = randomBytes(32).toString('hex');
      const proof_hash = createHash('sha256').update(proof).digest('hex');
      const challenge = await post(
        'challenges',
        {
          kind: 'worker',
          proof_hash,
          label,
          workspace_id: workspaceId,
          capabilities,
        },
        DesktopChallengeSchema,
      );
      return { challenge, proof };
    },
    claim: (id, proof) =>
      post(`challenges/${z.uuid().parse(id)}/claim`, { proof }, ClaimSchema),
    heartbeat: (token, fence) =>
      post('heartbeat', { fence }, HeartbeatSchema, token),
    job: (token) => post('jobs', {}, DesktopJobSchema.nullable(), token),
    start: (token, job, executionId) =>
      post(
        `jobs/${job.id}/start`,
        { lease_id: job.lease_id, execution_id: executionId },
        z.strictObject({ continue: z.boolean() }),
        token,
      ),
    check: (token, job) =>
      post(
        `jobs/${job.id}/check`,
        { lease_id: job.lease_id },
        z.strictObject({ continue: z.boolean() }),
        token,
      ),
    finish: (token, job, report) =>
      post(
        `jobs/${job.id}/finish`,
        { lease_id: job.lease_id, report },
        DesktopJobSchema,
        token,
      ),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [command, workspaceId, third, fourth, ...extra] =
      process.argv.slice(2);
    const execution = command === 'run';
    const label = (execution ? fourth : third) ?? 'Windows local worker';
    const productsRoot = execution ? third : null;
    if (
      (!execution && command !== 'pair') ||
      !workspaceId ||
      extra.length ||
      (execution && !productsRoot) ||
      (!execution && fourth)
    )
      throw new Error(
        'Usage: node apps/desktop/worker.mjs pair WORKSPACE_UUID [LABEL] | run WORKSPACE_UUID PRODUCTS_ROOT [LABEL]',
      );
    const abort = new AbortController();
    process.once('SIGINT', () => abort.abort());
    process.once('SIGTERM', () => abort.abort());
    let artifacts;
    let executePairedJob;
    if (execution) {
      const executor = await import('../../packages/executor/dist/index.js');
      const products = new executor.ProductSupervisor(productsRoot);
      artifacts = new executor.ArtifactSupervisor(
        products,
        new executor.ExecutionSupervisor(products),
      );
      executePairedJob = executor.executePairedJob;
    }
    const hosted = process.env.CREATOR_CONTROL === 'hosted';
    const origin = process.env.CREATOR_API_URL ?? 'http://127.0.0.1:4310';
    const client = workerClient(origin, { hosted });
    const approveAt = approvalOrigin(
      origin,
      hosted,
      process.env.CREATOR_WEB_URL,
    );
    const { challenge, proof } = await client.begin(
      workspaceId,
      label,
      execution ? ['artifact.run'] : ['artifact.verify'],
    );
    console.log(
      `Compare code ${challenge.comparison_code}. Approve in your signed-in system browser:\n${approveAt}/api/desktop/approve?id=${challenge.id}`,
    );
    let paired;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (abort.signal.aborted)
        throw new Error('Worker stopped before pairing');
      await sleep(2000);
      const result = await client.claim(challenge.id, proof);
      if (result.state === 'paired') {
        paired = result;
        break;
      }
    }
    if (!paired) throw new Error('Pairing timed out.');
    console.log(
      `Paired device ${paired.device.id}. ${execution ? 'Only owner-submitted exact-artifact jobs can run in reviewed WSL isolation.' : 'Presence reporting only; no generated-code dispatch.'} Closing the desktop window does not stop this process. Ctrl+C stops it.`,
    );
    let fence = paired.device.fence;
    let prior = '';
    let failures = 0;
    for (;;) {
      if (abort.signal.aborted) break;
      try {
        const current = await client.heartbeat(paired.token, fence);
        fence = current.device.fence;
        failures = 0;
        if (prior !== current.device.state) {
          console.log(`Worker state: ${current.device.state}`);
          prior = current.device.state;
        }
        if (current.device.state === 'shutdown') break;
        if (execution && current.device.state === 'active' && current.lease) {
          const job = await client.job(paired.token);
          if (job) {
            console.log(`Executing paired job ${job.id} once.`);
            // A job error is never fed back into the polling retry loop.
            try {
              await executePairedJob(
                job,
                artifacts,
                {
                  start: (executionId) =>
                    client.start(paired.token, job, executionId),
                  check: () => client.check(paired.token, job),
                  finish: (report) => client.finish(paired.token, job, report),
                },
                abort.signal,
              );
            } catch {
              throw new Error(
                'Paired job stopped or has an uncertain outcome; inspect its server and local execution records before any further work.',
              );
            }
          }
        }
      } catch (error) {
        if (String(error?.message).startsWith('Paired job')) throw error;
        // No work is dispatched during outages; leases expire at the authority.
        if (++failures >= 3) throw error;
      }
      await sleep(5000);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Worker stopped');
    process.exitCode = 1;
  }
}
