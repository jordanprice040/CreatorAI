import { useCallback, useEffect, useRef, useState } from 'react';
import { Money } from './money.js';
import {
  UsageSummarySchema,
  type PlanConnectionUsage,
  type UsageSummary,
  type Workspace,
} from '@creator/contracts';
import {
  api,
  message,
  STUDIO_CHANGED,
  STUDIO_WRITE_STARTED,
  writeOpen,
} from './oversight.js';
import { money } from './budgets.js';
import { AddExtraRequests, extraLine } from './extra-requests.js';
import {
  NO_WATCH,
  nextReadMs,
  watchAfterRead,
  watchAfterWrite,
} from './usage-refresh.js';
import './usage.css';

// Runbook step 9: one glance at the limits that stop work. Plan requests are counted against
// the studio's own caps exactly as admission counts them (rolling 24 hours); the provider's own
// plan allowance is not visible to the app, so it is never shown as a number.

const PROVIDER: Record<
  PlanConnectionUsage['kind'],
  { name: string; short: string; settings: string }
> = {
  chatgpt_plan: {
    name: 'ChatGPT plan',
    short: 'ChatGPT',
    settings: 'ChatGPT Settings > Usage',
  },
  claude_code: {
    name: 'Claude plan',
    short: 'Claude',
    settings: 'Claude Settings > Usage',
  },
};

/** "14:05 (in 3 h 20 min)", or "now" when the time has passed. */
export function untilText(iso: string, now: number): string {
  const ms = Date.parse(iso) - now;
  const at = new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (ms <= 0) return 'now';
  const mins = Math.ceil(ms / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const rel = h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
  return `${at} (in ${rel})`;
}

type Tone = 'ok' | 'warn' | 'down';
const worst = (tones: Tone[]): Tone =>
  tones.includes('down') ? 'down' : tones.includes('warn') ? 'warn' : 'ok';

export function planTone(p: PlanConnectionUsage): Tone {
  if (
    p.blockers.length > 0 ||
    p.daily.remaining === 0 ||
    p.unresolved > 0 ||
    p.provider_quota.state === 'exhausted'
  )
    return 'down';
  if (p.daily.remaining * 10 <= p.daily.cap) return 'warn';
  return 'ok';
}
export function costTone(c: NonNullable<UsageSummary['api_cost']>): Tone {
  const ceiling = BigInt(c.ceiling_nano_usd);
  const left = BigInt(c.remaining_nano_usd);
  if (c.unknown_calls > 0 || left === 0n) return 'down';
  if (left * 5n <= ceiling) return 'warn';
  return 'ok';
}

function Meter({
  used,
  cap,
  tone,
  label,
}: {
  used: number;
  cap: number;
  tone: Tone;
  label: string;
}) {
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 100;
  return (
    <span
      className={`usage-meter usage-${tone}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={cap}
      aria-valuenow={Math.min(used, cap)}
    >
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

function PlanBlock({
  p,
  now,
  workspace,
  csrf,
  reload,
}: {
  p: PlanConnectionUsage;
  now: number;
  workspace: Workspace;
  csrf: string;
  reload: () => void;
}) {
  const provider = PROVIDER[p.kind];
  const extra = extraLine(p.daily.extras, p.daily.configured_cap);
  const tone = planTone(p);
  return (
    <section className="usage-block" aria-label={p.label}>
      <h3>
        {p.label}
        {p.fixture && <span className="usage-tag">fixture</span>}
      </h3>
      {p.blockers.length > 0 && (
        <div className="small usage-alert">
          <p>No requests can run on this connection now:</p>
          <ul>
            {p.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="usage-line">
        <strong>
          {p.daily.used} of {p.daily.cap}
        </strong>{' '}
        studio requests in the last 24 hours
      </p>
      <Meter
        used={p.daily.used}
        cap={p.daily.cap}
        tone={tone}
        label={`${p.label}: ${p.daily.used} of ${p.daily.cap} requests in 24 hours`}
      />
      <p className="small">
        {p.daily.remaining === 0
          ? `Full. The next request is possible at ${p.daily.next_frees_at ? untilText(p.daily.next_frees_at, now) : 'once a request leaves the window'}${p.daily.can_add_extra ? ', or add extra requests now' : ''}.`
          : `${p.daily.remaining} left.`}{' '}
        {p.daily.remaining > 0 &&
          p.daily.next_frees_at &&
          `The window is rolling: the oldest request drops off at ${untilText(p.daily.next_frees_at, now)}`}
        {p.daily.remaining > 0 && p.daily.clears_at && (
          <>, and all of them by {untilText(p.daily.clears_at, now)}.</>
        )}
      </p>
      {extra && <p className="small">{extra}</p>}
      {p.daily.can_add_extra && csrf && (
        <AddExtraRequests
          path={`workspaces/${workspace.id}/plan-connections/${p.connection_id}`}
          csrf={csrf}
          version={p.connection_version}
          configured={p.daily.configured_cap}
          cap={p.daily.cap}
          onDone={reload}
        />
      )}
      {p.kind === 'chatgpt_plan' && p.codex_builds.cap > 0 && (
        <p className="small">
          Codex builds today: {p.codex_builds.used} of {p.codex_builds.cap}.
        </p>
      )}
      {p.runs.length > 0 && (
        <ul className="usage-runs">
          {p.runs.map((r) => (
            <li
              key={r.run_id}
              className={r.requests >= r.cap ? 'usage-alert' : undefined}
            >
              <span>Run {r.run_id.slice(0, 8)}</span>
              <span>
                {r.requests} of {r.cap} per-run requests
                {r.requests >= r.cap && ' (cap reached)'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {p.in_flight > 0 && <p className="small">A request is running now.</p>}
      {p.unresolved > 0 && (
        <p className="small usage-alert">
          {p.unresolved} request(s) have an unknown outcome. New requests wait
          until they are reconciled on Models and connections.
        </p>
      )}
      {p.provider_quota.state === 'exhausted' ? (
        <p className="small usage-alert">
          {provider.name} reported its own usage limit reached
          {p.provider_quota.observed_at
            ? ` at ${new Date(p.provider_quota.observed_at).toLocaleString()}`
            : ''}
          . Check {provider.settings} for when it resets.
        </p>
      ) : (
        <p className="small usage-note">
          Your {provider.name}&apos;s own allowance isn&apos;t visible to the
          app; {provider.settings} shows it and when it resets.
        </p>
      )}
    </section>
  );
}

export function UsagePanel({
  usage,
  workspace,
  now,
  csrf = '',
  reload = () => {},
}: {
  usage: UsageSummary;
  workspace: Workspace;
  now: number;
  /** The session's CSRF token, for the owner's extra-requests press (ADR-0094). */
  csrf?: string;
  reload?: () => void;
}) {
  const c = usage.api_cost;
  return (
    <>
      {usage.plans.length === 0 ? (
        <p className="small">
          No plan connections in this workspace. Add one on{' '}
          <a href={`#/connections/models?ws=${workspace.id}`}>
            Models and connections
          </a>
          .
        </p>
      ) : (
        usage.plans.map((p) => (
          <PlanBlock
            key={p.connection_id}
            p={p}
            now={now}
            workspace={workspace}
            csrf={csrf}
            reload={reload}
          />
        ))
      )}
      <section className="usage-block" aria-label="App usage">
        <h3>App usage in this workspace</h3>
        <p className="small">
          {usage.app.plan_requests_24h} plan requests in 24 hours,{' '}
          {usage.app.plan_requests_7d} in 7 days,{' '}
          {usage.app.plan_requests_total} in total. Plan requests use your
          subscription, not API money.
        </p>
      </section>
      <section className="usage-block" aria-label="API cost">
        <h3>API cost</h3>
        {c ? (
          <>
            <p className="usage-line">
              <strong>
                <Money nano={c.exposure_nano_usd} fixture={false} />
              </strong>{' '}
              of <Money nano={c.ceiling_nano_usd} fixture={false} /> ceiling ·{' '}
              <Money nano={c.remaining_nano_usd} fixture={false} /> left
            </p>
            <Meter
              used={Number(BigInt(c.exposure_nano_usd) / 1_000_000n)}
              cap={Number(BigInt(c.ceiling_nano_usd) / 1_000_000n)}
              tone={costTone(c)}
              label={`API cost: ${money(c.exposure_nano_usd, false)} of ${money(c.ceiling_nano_usd, false)}`}
            />
            <p className="small">
              {c.paid_calls} paid call(s) since{' '}
              {new Date(c.counted_since).toLocaleDateString()}, across all
              workspaces. Running and unsettled calls count at their reserved
              amount. Change the ceiling in{' '}
              <a href={`#/settings/general?ws=${workspace.id}`}>Settings</a>.
            </p>
            {c.unknown_calls > 0 && (
              <p className="small usage-alert">
                {c.unknown_calls} paid call(s) have an unknown cost; new paid
                calls wait until they are reconciled.
              </p>
            )}
          </>
        ) : (
          <p className="small">{usage.api_cost_hidden_reason}</p>
        )}
      </section>
    </>
  );
}

/**
 * The top bar's usage button; it reads every minute, on focus, on page changes, and every few
 * seconds for a while after a write here.
 */
export function UsageIndicator({
  workspace,
  csrf = '',
}: {
  workspace: Workspace;
  csrf?: string;
}) {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const ref = useRef<HTMLDetailsElement>(null);
  // Only the newest read may show, so a slow older answer cannot put back an older count.
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Until when to read every few seconds (usage-refresh.ts).
  const watch = useRef(NO_WATCH);
  const load = useCallback(() => {
    const mine = ++seq.current;
    clearTimeout(timer.current);
    api(UsageSummarySchema, `workspaces/${workspace.id}/usage`)
      .then((u) => {
        if (mine !== seq.current) return;
        watch.current = watchAfterRead(
          u.plans,
          Date.now(),
          watch.current,
          writeOpen(),
        );
        setUsage(u);
        setError('');
        setNow(Date.now());
      })
      .catch((e: unknown) => {
        if (mine === seq.current) setError(message(e));
      })
      .finally(() => {
        // Each read schedules the next one; a newer read or unmount cancels it.
        if (mine !== seq.current) return;
        timer.current = setTimeout(
          load,
          nextReadMs(Date.now(), watch.current, document.hidden),
        );
      });
  }, [workspace.id]);
  useEffect(() => {
    setUsage(null);
    watch.current = NO_WATCH;
    load();
    // A write in this window (a chat answer, starting a build or a qualification) may use plan
    // requests now or, for work that carries on on the server, over the next while: read
    // shortly after it is sent and again after it ends, then keep watching, at most 10 minutes
    // from the latest write (usage-refresh.ts). Requests made from the CLI or another window
    // show at the next minute's read.
    let soon: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      watch.current = watchAfterWrite(Date.now(), watch.current);
      clearTimeout(soon);
      soon = setTimeout(load, 300);
    };
    window.addEventListener('focus', load);
    window.addEventListener('hashchange', load);
    window.addEventListener(STUDIO_CHANGED, changed);
    // Also when the write is sent: a long one (a qualification run) uses plan requests while
    // it is still open, so the fast reads start now and running requests keep them going.
    window.addEventListener(STUDIO_WRITE_STARTED, changed);
    return () => {
      clearTimeout(timer.current);
      clearTimeout(soon);
      seq.current++;
      window.removeEventListener('focus', load);
      window.removeEventListener('hashchange', load);
      window.removeEventListener(STUDIO_CHANGED, changed);
      window.removeEventListener(STUDIO_WRITE_STARTED, changed);
    };
  }, [load]);
  useEffect(() => {
    const close = (e: KeyboardEvent | MouseEvent) => {
      const d = ref.current;
      if (!d?.open) return;
      if (
        e instanceof KeyboardEvent
          ? e.key === 'Escape'
          : !d.contains(e.target as Node)
      )
        d.open = false;
    };
    document.addEventListener('keydown', close);
    document.addEventListener('mousedown', close);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('mousedown', close);
    };
  }, []);
  const tones: Tone[] = [
    ...(usage?.plans.map(planTone) ?? []),
    ...(usage?.api_cost ? [costTone(usage.api_cost)] : []),
  ];
  const tone: Tone = error ? 'warn' : worst(tones);
  // ADR-0094: a connection whose daily cap is used up is named in the button.
  const full = usage?.plans.some((p) => p.daily.remaining === 0) ?? false;
  // The busiest plan connection stands for all of them in the button.
  const top = usage?.plans
    .slice()
    .sort((a, b) => b.daily.used / b.daily.cap - a.daily.used / a.daily.cap)[0];
  return (
    <details
      className="usage"
      ref={ref}
      onToggle={(e) => e.currentTarget.open && load()}
    >
      <summary
        className={`usage-summary usage-${tone}`}
        title="Plan and API usage"
      >
        <span className="dot" aria-hidden="true" />
        {!usage && !error && 'Usage…'}
        {error && !usage && 'Usage unavailable'}
        {usage && (
          <>
            {top && (
              <span>
                {PROVIDER[top.kind].short} {top.daily.used}/{top.daily.cap}
                {/* ADR-0094: say it in words too when a connection is used up. */}
                {full && ' · used up'}
              </span>
            )}
            {usage.api_cost && (
              <span>
                API{' '}
                <Money
                  nano={usage.api_cost.exposure_nano_usd}
                  fixture={false}
                  inButton
                />
                /
                <Money
                  nano={usage.api_cost.ceiling_nano_usd}
                  fixture={false}
                  inButton
                />
              </span>
            )}
            {!top && !usage.api_cost && <span>Usage</span>}
          </>
        )}
      </summary>
      <div
        className="usage-panel"
        role="region"
        aria-label="Plan and API usage"
      >
        <h2>Usage</h2>
        {error && <p className="error small">{error}</p>}
        {usage && (
          <UsagePanel
            usage={usage}
            workspace={workspace}
            now={now}
            csrf={csrf}
            reload={load}
          />
        )}
        <p className="small usage-foot">
          {usage && `Updated ${new Date(usage.as_of).toLocaleTimeString()}. `}
          <button className="text" onClick={load}>
            Refresh
          </button>
        </p>
      </div>
    </details>
  );
}
