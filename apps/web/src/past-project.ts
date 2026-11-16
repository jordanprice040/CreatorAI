// F9 "Start a similar project" (ADR-0125). Turns a past discovery run's setup into the values
// the Discover form starts from. Pure functions with type-only imports, so the rules load in
// tests without a browser. Nothing here attaches evidence, grants permission, picks a budget,
// raises a cap or starts anything: the form shows the copy, and Start goes through the same
// checks and the server's gates as any other start.
import type { PastProject, ResponseType } from '@creator/contracts';
import type {
  DataClass,
  Oversight,
  RouteKind,
  RoutineSettings,
} from './discover-defaults.js';

/** What the Discover form is filled with. Text fields are as the form holds them. */
export type PastProjectFill = {
  theme: string;
  fieldA: string;
  fieldB: string;
  users: string;
  context: string;
  problem: string;
  measure: string;
  data: string;
  timeLimit: string;
  budgetLimit: string;
  seed: string;
  constraints: string;
  excluded: Partial<Record<ResponseType, string>>;
  revisions: number;
  maxAgeDays: number;
  dataClass: DataClass;
  oversight: Oversight;
  route: RouteKind;
  /** The plan connection and model to select; empty leaves the form's own default. */
  connectionId: string;
  model: string;
  /** For Explore for me and Search the web, one website per line; empty when it had none. */
  onlySites: string;
  skipSites: string;
  /** Plain-words notes on what was not copied as it was, and why. */
  notes: string[];
};

/**
 * Websites handed to Explore for me and Search the web, one per line. Each hand-off has its
 * own nonce, so using the same past project twice fills the fields again.
 */
export type SitesHandoff = {
  /** Left out when the past project had no such list, so a typed list is kept (review 1 L-3). */
  only?: string;
  skip?: string;
  nonce: number;
} | null;

/** The website lists a fill hands on: only those the past project had. */
export function sitesHandoff(f: PastProjectFill, nonce: number): SitesHandoff {
  if (!f.onlySites && !f.skipSites) return null;
  return {
    ...(f.onlySites ? { only: f.onlySites } : {}),
    ...(f.skipSites ? { skip: f.skipSites } : {}),
    nonce,
  };
}

/** Where the website lists went, in words (review 1 N-1); empty when there were none. */
export function sitesText(f: PastProjectFill): string {
  if (f.onlySites && f.skipSites)
    return 'Its websites are filled in: the only-these and skip lists on Explore for me, and the skip list on Search the web.';
  if (f.onlySites)
    return 'Its only-these website list is filled in on Explore for me.';
  if (f.skipSites)
    return 'Its skip website list is filled in on Explore for me and Search the web.';
  return '';
}

/**
 * A plan connection as the form sees it now: its verified models, the models qualified for
 * every discovery step, why it refuses (blockers) and the data classes it allows.
 */
export type ConnectionNow = {
  id: string;
  label: string;
  models: string[];
  qualified: string[];
  blockers: string[];
  allowedDataClasses: string[];
};

/** Always said: what a new project never takes from a past one. */
export const NOT_COPIED =
  'Claims, evidence roles, approvals, decisions, API budgets and price lists, and routine approvals are not copied: attach the claims this project rests on and confirm each permission again.';

/** The day a past project started, in this browser's time zone (review 1 N-3). */
export const startedDay = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

/** A short label for a past project in the picker. */
export function pastProjectLabel(
  p: PastProject,
  day: (iso: string) => string = startedDay,
): string {
  const started = day(p.started_at);
  const title = p.brief.body.theme || p.brief.title;
  const cut = title.length > 70 ? `${title.slice(0, 69)}…` : title;
  return `${cut} · ${started} · ${STATE[p.state] ?? p.state}`;
}

const STATE: Record<string, string> = {
  queued: 'queued',
  running: 'running',
  waiting_dependency: 'waiting',
  waiting_human: 'waiting for you',
  paused_operator: 'paused',
  reconciling: 'checking',
  succeeded: 'finished',
  failed: 'failed',
  cancelled: 'stopped',
};

const DATA_TEXT: Record<DataClass, string> = {
  synthetic: 'synthetic',
  public: 'public',
  private_approved: 'private (approved)',
};

/**
 * The form values for a new project from a past one. `defaults` are the values the form would
 * start with (studio defaults with this person's preset), used wherever a past value cannot
 * be copied as it was. The rules match a saved preset's: a fixture workspace stays synthetic,
 * private data is chosen again on purpose for each start, only the form's own choices are
 * taken, and a connection or model that is no longer offered is not selected.
 */
export function fillFromPast(
  p: PastProject,
  opts: {
    fixture: boolean;
    defaults: RoutineSettings;
    connections: readonly ConnectionNow[];
  },
): PastProjectFill {
  const b = p.brief.body;
  const s = p.settings;
  const d = opts.defaults;
  const notes: string[] = [];

  let dataClass: DataClass = s.data_class;
  if (opts.fixture && dataClass !== 'synthetic') {
    dataClass = 'synthetic';
    notes.push(
      'This is a fixture workspace, so it starts with synthetic data whatever the past project used.',
    );
  }
  if (dataClass === 'private_approved') {
    // Defaults and presets never hold the private class (discover-defaults parsePreset).
    dataClass = d.dataClass;
    notes.push(
      `The past project shared private data. That is chosen again for each start, so this one starts with ${DATA_TEXT[dataClass]} data.`,
    );
  }

  let oversight: Oversight = d.oversight;
  if (s.oversight === 'human_in_loop' || s.oversight === 'supervised')
    oversight = s.oversight;
  else if (s.oversight)
    notes.push(
      'The past project ran in a mode Discover does not offer, so this one starts with the usual oversight.',
    );

  const revisions =
    s.max_revisions === 0 || s.max_revisions === 1 || s.max_revisions === 2
      ? s.max_revisions
      : d.revisions;

  const excluded: Partial<Record<ResponseType, string>> = {};
  for (const e of s.excluded) excluded[e.perspective] = e.reason;

  let route: RouteKind = d.route;
  let connectionId = '';
  let model = '';
  const conn = p.connection;
  if (conn?.kind === 'api') {
    route = 'api';
    notes.push(
      'It ran on an API budget: pick the budget and price list for this project.',
    );
  } else if (conn?.kind === 'subscription') {
    route = 'subscription';
    const now = opts.connections.find((x) => x.id === conn.connection_id);
    // Review 1 L-1: the past connection and model are selected only when they can run a
    // discovery now; otherwise the form keeps its own default, which skips blocked ones.
    if (!now)
      notes.push(
        'Its plan connection is no longer listed, so the usual connection is selected.',
      );
    else if (now.blockers.length)
      notes.push(
        `Its plan connection ${now.label} can't run a discovery right now (${now.blockers[0]}), so the usual connection is selected.`,
      );
    else if (!now.allowedDataClasses.includes(dataClass))
      notes.push(
        `${now.label} does not allow ${DATA_TEXT[dataClass]} data, so the usual connection is selected.`,
      );
    else if (!now.models.includes(conn.model_id))
      notes.push(
        `${conn.model_id} is no longer a verified model on ${now.label}, so the usual connection and model are selected.`,
      );
    else if (!now.qualified.includes(conn.model_id))
      notes.push(
        `${conn.model_id} is not qualified for every discovery step on ${now.label}, so the usual connection and model are selected.`,
      );
    else {
      connectionId = now.id;
      model = conn.model_id;
    }
  } else if (conn?.kind === 'local')
    notes.push(
      'It ran on a local model, which Discover does not offer, so the usual connection is selected.',
    );

  return {
    theme: b.theme,
    fieldA: b.fields[0],
    fieldB: b.fields[1],
    users: b.target_users,
    context: b.context ?? '',
    problem: b.measurable_problem,
    measure: b.outcome_measure,
    data: b.data_and_tools.join('\n'),
    timeLimit: b.time_limit,
    budgetLimit: b.budget_limit,
    seed: b.nae_seed ?? '',
    constraints: b.constraints.join('\n'),
    excluded,
    revisions,
    maxAgeDays:
      s.max_age_days >= 1 && s.max_age_days <= 3650 ? s.max_age_days : 180,
    dataClass,
    oversight,
    route,
    connectionId,
    model,
    onlySites: p.sites.only_hosts.join('\n'),
    skipSites: p.sites.excluded_hosts.join('\n'),
    notes,
  };
}

/** The routine settings a fill set, so the form can say they came from the past project. */
export function copiedSettings(f: PastProjectFill): Partial<RoutineSettings> {
  return {
    timeLimit: f.timeLimit,
    budgetLimit: f.budgetLimit,
    constraints: f.constraints,
    dataAndTools: f.data,
    dataClass: f.dataClass,
    revisions: f.revisions,
    oversight: f.oversight,
    // Model-call permission is a grant: never copied, so it keeps the form's own value.
    route: f.route,
  };
}
