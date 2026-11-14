import { useViewMode } from './view-mode.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  z,
  ArtifactSummarySchema,
  MarketingDraftRequestSchema,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { api, message, when } from './oversight.js';
import { useOnShow } from './page-active.js';
import { ShowOlder, useOlder } from './older.js';

const Campaign = z.object({
  id: z.string(),
  content_hash: z.string(),
  cancelled: z.boolean(),
  request: MarketingDraftRequestSchema,
  content: z.object({
    label: z.string(),
    landing_page: z.string(),
    positioning: z.string(),
    demonstrations: z.array(z.unknown()),
    claims: z.array(z.unknown()),
    pricing: z.unknown(),
  }),
});
const Detail = z.object({
  campaign: Campaign,
  evidence_status: z.string(),
  grants: z.array(
    z.object({
      id: z.string(),
      revoked: z.boolean(),
      used: z.number(),
      max_deliveries: z.number(),
      expires_at: z.string(),
    }),
  ),
  deliveries: z.array(
    z.object({
      id: z.string(),
      recipient: z.string(),
      state: z.string(),
      native_id: z.string().nullable(),
      reason: z.string().nullable(),
    }),
  ),
  observations: z.array(z.unknown()),
  suppressions: z.array(
    z.object({ recipient: z.string(), reason: z.string() }),
  ),
  measurement: z.unknown(),
});

/** New X08 screen; uses existing session helper and CSS without changing shared components. */
export function Marketing({
  workspace,
  session,
}: {
  workspace: Workspace;
  session: SessionInfo | null;
}) {
  const { standard } = useViewMode();
  const base = `workspaces/${workspace.id}`;
  const [campaigns, setCampaigns] = useState<z.infer<typeof Campaign>[]>([]);
  const [artifacts, setArtifacts] = useState<
    z.infer<typeof ArtifactSummarySchema>[]
  >([]);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<z.infer<typeof Detail> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [artifactId, setArtifactId] = useState('');
  const [audience, setAudience] = useState('Local synthetic reviewers');
  const [provenance, setProvenance] = useState(
    'Owner-created synthetic test audience; no contact information.',
  );
  const [recipients, setRecipients] = useState('test:reviewer1');
  const [hypothesis, setHypothesis] = useState(
    'A reviewer can inspect the recorded demonstration and provide feedback.',
  );
  const [price, setPrice] = useState('');
  const [threshold, setThreshold] = useState('1');
  const [grantId, setGrantId] = useState('');
  const [cap, setCap] = useState('1');
  const [recipient, setRecipient] = useState('test:reviewer1');
  const [simulation, setSimulation] = useState('delivered');
  const [reason, setReason] = useState(
    'Owner requested local fixture control.',
  );
  const [note, setNote] = useState('');
  // Newest first; campaigns past the newest 200 come a page at a time (audit L-9).
  const shown = useOlder(
    campaigns,
    Campaign,
    `${base}/marketing-campaigns`,
    200,
  );
  const loadSequence = useRef(0);
  async function load(id = selected) {
    const sequence = ++loadSequence.current;
    setDetail(null);
    const [list, packages, next] = await Promise.all([
      api(z.array(Campaign), `${base}/marketing-campaigns`),
      api(z.array(ArtifactSummarySchema), `${base}/artifacts`),
      id
        ? api(Detail, `${base}/marketing-campaigns/${id}`)
        : Promise.resolve(null),
    ]);
    if (sequence !== loadSequence.current) return;
    setCampaigns(list);
    setArtifacts(packages);
    setDetail(next);
  }
  useEffect(() => {
    setSelected('');
    setDetail(null);
    setGrantId('');
    setArtifactId('');
    load('').catch((e) => setError(message(e)));
    return () => {
      loadSequence.current++;
    };
  }, [workspace.id]);
  // Packages and campaigns made elsewhere appear when this page is shown again.
  useOnShow(() => void load().catch((e) => setError(message(e))));
  async function act(path: string, body: unknown) {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      await api(z.unknown(), `${base}/${path}`, {
        body,
        csrf: session.csrf_token,
      });
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function draft(e: FormEvent) {
    e.preventDefault();
    if (!session) return;
    const artifact = artifacts.find((a) => a.id === artifactId);
    if (!artifact) return;
    setBusy(true);
    setError('');
    try {
      const row = await api(Campaign, `${base}/marketing-campaigns`, {
        csrf: session.csrf_token,
        body: {
          artifact_id: artifact.id,
          manifest_sha256: artifact.manifest_sha256,
          channel: 'local_fixture',
          budget_nano_usd: '0',
          audience: {
            description: audience,
            provenance,
            recipients: recipients.split(',').map((s) => s.trim()),
          },
          experiment: {
            hypothesis,
            metric: 'feedback_received',
            success_threshold: Number(threshold),
            price_hypothesis_cents: price === '' ? null : Number(price),
            stop_rule:
              'Stop at grant cap or expiry; owner may cancel at any time.',
          },
        },
      });
      setSelected(row.id);
      setGrantId('');
      await load(row.id);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const path = `marketing-campaigns/${selected}`;
  return (
    <section className="panel" aria-labelledby="marketing-title">
      <h2 id="marketing-title">Campaigns</h2>
      <p>
        Local fixture delivery only · $0 budget · no outreach or ads. Drafts
        describe recorded checks; they do not establish customer validation or
        demand.
      </p>
      {error && <p role="alert">{error}</p>}
      <button
        disabled={busy}
        onClick={() => load().catch((e) => setError(message(e)))}
      >
        Refresh campaigns
      </button>
      <form onSubmit={draft}>
        <h3>Draft from a verified package</h3>
        <label>
          Verified artifact
          <select
            required
            value={artifactId}
            onChange={(e) => setArtifactId(e.target.value)}
          >
            <option value="">Select a package</option>
            {artifacts
              .filter((a) => a.current && a.state === 'verified')
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {standard
                    ? `Spec v${a.spec.version} · built ${when(a.created_at)}`
                    : `${a.id} · ${a.backend}`}
                </option>
              ))}
          </select>
        </label>
        <label>
          Intended audience
          <input
            required
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
          />
        </label>
        <label>
          Audience provenance
          <textarea
            required
            value={provenance}
            onChange={(e) => setProvenance(e.target.value)}
          />
        </label>
        <label>
          Synthetic recipients (comma separated test: IDs)
          <input
            required
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
          />
        </label>
        <label>
          Hypothesis (unvalidated)
          <textarea
            required
            value={hypothesis}
            onChange={(e) => setHypothesis(e.target.value)}
          />
        </label>
        <label>
          Feedback success threshold
          <input
            type="number"
            min="1"
            max="100"
            required
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </label>
        <label>
          Optional price hypothesis (USD cents; no checkout)
          <input
            type="number"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </label>
        <button disabled={busy || !session}>Create reviewable draft</button>
      </form>
      <h3>Review campaigns</h3>
      {campaigns.length === 0 && (
        <p>
          No campaigns. Package a verified build first; it then appears under
          Projects › Try.
        </p>
      )}
      <label>
        Campaign
        <select
          value={selected}
          onChange={(e) => {
            const id = e.target.value;
            setSelected(id);
            setGrantId('');
            load(id).catch((e) => setError(message(e)));
          }}
        >
          <option value="">Select a campaign</option>
          {shown.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id}
              {c.cancelled ? ' · cancelled' : ''}
            </option>
          ))}
        </select>
      </label>
      <ShowOlder list={shown} what="campaigns" />
      {detail && (
        <>
          <p>
            {detail.campaign.content.label} · Evidence: {detail.evidence_status}
          </p>
          <p>
            Content binding:{' '}
            <code style={{ overflowWrap: 'anywhere' }}>
              {detail.campaign.content_hash}
            </code>
          </p>
          <h3>Positioning and landing draft</h3>
          <p>{detail.campaign.content.positioning}</p>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {detail.campaign.content.landing_page}
          </pre>
          <details>
            <summary>Claims, demonstration recipes and experiment</summary>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {JSON.stringify(
                {
                  claims: detail.campaign.content.claims,
                  demonstrations: detail.campaign.content.demonstrations,
                  pricing: detail.campaign.content.pricing,
                  request: detail.campaign.request,
                },
                null,
                2,
              )}
            </pre>
          </details>
          <h3>Authorize bounded fixture delivery</h3>
          <label>
            Delivery cap
            <input
              type="number"
              min="1"
              max="100"
              value={cap}
              onChange={(e) => setCap(e.target.value)}
            />
          </label>
          <label>
            Control reason / grant rationale
            <input
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            disabled={
              busy ||
              !session ||
              detail.campaign.cancelled ||
              detail.evidence_status !== 'current'
            }
            onClick={() =>
              act(`${path}/grant`, {
                content_hash: detail.campaign.content_hash,
                expires_at: new Date(Date.now() + 86400000).toISOString(),
                max_deliveries: Number(cap),
                budget_nano_usd: '0',
                rationale: reason,
              })
            }
          >
            Grant exact draft and audience for 24 hours
          </button>
          <label>
            Grant
            <select
              value={grantId}
              onChange={(e) => setGrantId(e.target.value)}
            >
              <option value="">Select grant</option>
              {detail.grants.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.id} · {g.used}/{g.max_deliveries}
                  {g.revoked ? ' · revoked' : ''} · expires {g.expires_at}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={busy || !session || !grantId}
            onClick={() => act(`${path}/revoke`, { grant_id: grantId, reason })}
          >
            Revoke selected grant
          </button>
          <button
            disabled={busy || !session || detail.campaign.cancelled}
            onClick={() => act(`${path}/cancel`, { reason })}
          >
            Cancel campaign
          </button>
          <h3>Test delivery and opt-out</h3>
          <label>
            Recipient
            <input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
          </label>
          <label>
            Simulated outcome
            <select
              value={simulation}
              onChange={(e) => setSimulation(e.target.value)}
            >
              <option value="delivered">Local acceptance</option>
              <option value="unknown_after_accept">Lost acknowledgement</option>
              <option value="failed_before_accept">Definitive failure</option>
            </select>
          </label>
          <button
            disabled={busy || !session || !grantId || detail.campaign.cancelled}
            onClick={() =>
              act(`${path}/deliver`, {
                grant_id: grantId,
                recipient,
                simulation,
              })
            }
          >
            Deliver to local fixture sink
          </button>
          <button
            disabled={busy || !session}
            onClick={() => act('marketing-suppressions', { recipient, reason })}
          >
            Record opt-out / suppress
          </button>
          <label>
            Fixture feedback note
            <textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <ul>
            {detail.deliveries.map((d) => (
              <li key={d.id}>
                {d.recipient}: {d.state} ·{' '}
                {d.native_id ?? 'No acknowledged native ID'} · {d.reason}
                {['unknown', 'dispatching'].includes(d.state) && (
                  <button
                    disabled={busy || !session}
                    onClick={() =>
                      act(`${path}/reconcile`, { delivery_id: d.id })
                    }
                  >
                    Reconcile without resending
                  </button>
                )}
                {d.state === 'delivered' && (
                  <button
                    disabled={busy || !session || !note.trim()}
                    onClick={() =>
                      act(`${path}/observe`, {
                        delivery_id: d.id,
                        event_key: `feedback:${d.id}`,
                        metric: detail.campaign.request.experiment.metric,
                        note,
                      })
                    }
                  >
                    Record fixture feedback
                  </button>
                )}
              </li>
            ))}
          </ul>
          <h3>Measured fixture outcomes</h3>
          <pre>{JSON.stringify(detail.measurement, null, 2)}</pre>
          <p>
            Suppressed recipients:{' '}
            {detail.suppressions.map((s) => s.recipient).join(', ') ||
              'None recorded'}
          </p>
        </>
      )}
    </section>
  );
}
