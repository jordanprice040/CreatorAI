// The studio's page map (step 9, "fewer, task-shaped pages"): seven pages since the Autopilot
// page (November 15), each holding the earlier one-task screens as tabs. Pure data and functions with no imports, so the route
// rules load in tests without a browser. Views keep their old keys, so records, links and
// per-tab form drafts are unchanged; only where they sit and how the address reads changed.

/** Every screen, by its view key. A view is one tab of one page. */
export type View =
  | 'chat'
  | 'path'
  | 'overview'
  | 'submit'
  | 'catalog'
  | 'files'
  | 'compare'
  | 'proposals'
  | 'evidence'
  | 'decisions'
  | 'runs'
  | 'budgets'
  | 'scores'
  | 'search'
  | 'activity'
  | 'studies'
  | 'build'
  | 'gallery'
  | 'desktop'
  | 'operations'
  | 'storage'
  | 'marketing'
  | 'portfolio'
  | 'models'
  | 'settings'
  | 'github'
  | 'payments'
  | 'autopilot'
  | 'runcompare'
  | 'notifications'
  | 'notifysettings';

export type PageKey =
  | 'chat'
  | 'projects'
  | 'autopilot'
  | 'sources'
  | 'monitor'
  | 'connections'
  | 'settings';

export type Section = {
  view: View;
  /** The tab's part of the address: `#/<page>/<slug>`. Unique within its page. */
  slug: string;
  /** The tab's name. */
  label: string;
  /**
   * The tab row entry it sits under, when several sections share one tab (Launch); they are
   * shown as a second row of links under it.
   */
  group?: string;
};

export type Page = { key: PageKey; label: string; sections: Section[] };

/** The page map. The first section of a page is where the page opens on a first visit. */
export const PAGES: readonly Page[] = [
  {
    key: 'chat',
    label: 'Chat',
    sections: [{ view: 'chat', slug: 'conversations', label: 'Chat' }],
  },
  {
    key: 'projects',
    label: 'Projects',
    sections: [
      { view: 'path', slug: 'path', label: 'Path' },
      { view: 'submit', slug: 'discover', label: 'Discover' },
      { view: 'compare', slug: 'decide', label: 'Decide' },
      { view: 'proposals', slug: 'proposals', label: 'Proposals' },
      { view: 'scores', slug: 'specs', label: 'Scores and specs' },
      { view: 'build', slug: 'build', label: 'Build' },
      { view: 'gallery', slug: 'try', label: 'Try' },
      { view: 'payments', slug: 'sell', label: 'Sell', group: 'Launch' },
      {
        view: 'marketing',
        slug: 'campaigns',
        label: 'Campaigns',
        group: 'Launch',
      },
      {
        view: 'portfolio',
        slug: 'maintain',
        label: 'Maintain',
        group: 'Launch',
      },
    ],
  },
  // ADR-0111 (Jordan's request, November 15): the whole autopilot flow on one page, under
  // Projects since it takes the same path for you: its settings, start, Stop and Continue,
  // progress, and what to do when it stops.
  {
    key: 'autopilot',
    label: 'Autopilot',
    sections: [
      { view: 'autopilot', slug: 'run', label: 'Autopilot' },
      // ADR-0120 (F7): two autopilots side by side, read only.
      { view: 'runcompare', slug: 'compare', label: 'Compare runs' },
    ],
  },
  {
    key: 'sources',
    label: 'Sources',
    sections: [
      { view: 'evidence', slug: 'claims', label: 'Sources and claims' },
      { view: 'catalog', slug: 'library', label: 'Library' },
      { view: 'files', slug: 'files', label: 'Files' },
      { view: 'search', slug: 'search', label: 'Search' },
    ],
  },
  {
    key: 'monitor',
    label: 'Monitor',
    sections: [
      { view: 'overview', slug: 'overview', label: 'Overview' },
      { view: 'decisions', slug: 'approvals', label: 'Approvals' },
      // ADR-0130 (N2): every notification, the bell's "View all".
      { view: 'notifications', slug: 'notifications', label: 'Notifications' },
      { view: 'runs', slug: 'runs', label: 'Runs' },
      { view: 'activity', slug: 'activity', label: 'Activity' },
      { view: 'budgets', slug: 'budgets', label: 'Budgets' },
      { view: 'operations', slug: 'workers', label: 'Workers' },
      // ADR-0121 (F10): disk per project and the confirmed build-workspace cleanup.
      { view: 'storage', slug: 'storage', label: 'Storage' },
    ],
  },
  {
    key: 'connections',
    label: 'Models and connections',
    sections: [
      { view: 'models', slug: 'models', label: 'Models' },
      { view: 'github', slug: 'github', label: 'GitHub' },
      { view: 'desktop', slug: 'devices', label: 'Devices' },
    ],
  },
  {
    key: 'settings',
    label: 'Settings',
    sections: [
      { view: 'settings', slug: 'general', label: 'Owner settings' },
      // ADR-0130 (N2): how and when you are told about things, for you only.
      {
        view: 'notifysettings',
        slug: 'notifications',
        label: 'Notifications',
      },
      { view: 'studies', slug: 'study', label: 'Study' },
    ],
  },
];

/** Where the studio opens when the address names no page. */
export const HOME: View = 'chat';

const ALL: { page: Page; section: Section }[] = PAGES.flatMap((page) =>
  page.sections.map((section) => ({ page, section })),
);

export const isView = (v: string): v is View =>
  ALL.some((e) => e.section.view === v);

/** The page that holds a view. Every view is in exactly one page. */
export function pageOf(view: View): Page {
  return (ALL.find((e) => e.section.view === view) ?? ALL[0]!).page;
}
export function sectionOf(view: View): Section {
  return (ALL.find((e) => e.section.view === view) ?? ALL[0]!).section;
}
/** The tab's own name, e.g. "Decide". */
export const viewLabel = (view: View) => sectionOf(view).label;
/** Where a view is, e.g. "Projects › Decide", for buttons that leave the current page. */
export function placeLabel(view: View, from?: View): string {
  const page = pageOf(view);
  const section = sectionOf(view);
  if (from && pageOf(from).key === page.key) return section.label;
  const tab = section.group
    ? `${section.group} › ${section.label}`
    : section.label;
  return `${page.label} › ${tab}`;
}

/** The tab row of a page: one entry per tab, a shared group counting once. */
export function tabsOf(
  page: Page,
  sections: readonly Section[] = page.sections,
): { label: string; sections: Section[] }[] {
  const tabs: { label: string; sections: Section[] }[] = [];
  for (const s of sections) {
    const label = s.group ?? s.label;
    const tab = tabs.find((t) => t.label === label);
    if (tab) tab.sections.push(s);
    else tabs.push({ label, sections: [s] });
  }
  return tabs;
}

export type Route = {
  view: View;
  ws: string;
  /** The item the view has open (a record, workflow, decision, `claim:<id>` …). */
  id: string;
  q: string;
};

/**
 * Reads `#/<page>/<tab>?ws=…&id=…&q=…`. Addresses from before the page map (`#/<view>?…`)
 * still open the same screen; a page without a known tab opens its first one; anything else
 * opens the studio's home.
 */
export function parseRoute(hash: string): Route {
  const m = /^#\/([a-z]+)(?:\/([a-z]+))?(?:\?(.*))?$/.exec(hash);
  const p = new URLSearchParams(m?.[3] ?? '');
  const first = m?.[1] ?? '';
  const second = m?.[2] ?? '';
  const page = PAGES.find((pg) => pg.key === first);
  let view: View = HOME;
  if (page && (second || !isView(first)))
    view = (page.sections.find((s) => s.slug === second) ?? page.sections[0]!)
      .view;
  else if (isView(first)) view = first;
  return {
    view,
    ws: p.get('ws') ?? '',
    id: p.get('id') ?? '',
    q: p.get('q') ?? '',
  };
}
export function routeHash(r: Route): string {
  const p = new URLSearchParams();
  if (r.ws) p.set('ws', r.ws);
  if (r.id) p.set('id', r.id);
  if (r.q) p.set('q', r.q);
  const qs = p.toString();
  return `#/${pageOf(r.view).key}/${sectionOf(r.view).slug}${qs ? `?${qs}` : ''}`;
}

/**
 * ADR-0082 (P19): the tabs Standard leaves out of the navigation because few people need them
 * day to day. Their routes still open (links, addresses, Chat buttons), and an open one is
 * listed while it is open. Advanced lists every tab. Runs and Library joined on November 14
 * (final UX pass, section 9; ADR-0103): Discover and Decide now show discovery progress and
 * what to do next, and records open from their own pages.
 */
export const ADVANCED_ONLY: readonly View[] = [
  'runs',
  'catalog',
  'payments',
  'marketing',
  'portfolio',
  'operations',
  'studies',
];

/** The sections of a page the navigation lists in this view mode, with `current` always kept. */
export function shownSections(
  page: Page,
  standard: boolean,
  current?: View,
): Section[] {
  return page.sections.filter(
    (s) => !standard || s.view === current || !ADVANCED_ONLY.includes(s.view),
  );
}

/**
 * The tab names a page hides in Standard right now: a hidden group is named once; when its
 * open section keeps the group's tab in the row, the hidden sections are named instead.
 */
export function hiddenTabs(
  page: Page,
  standard: boolean,
  current?: View,
): string[] {
  if (!standard) return [];
  const shown = shownSections(page, true, current);
  const names: string[] = [];
  for (const s of page.sections)
    if (!shown.includes(s)) {
      const partlyShown = s.group && shown.some((x) => x.group === s.group);
      const n = partlyShown ? s.label : (s.group ?? s.label);
      if (!names.includes(n)) names.push(n);
    }
  return names;
}
