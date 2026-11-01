// The studio's page map (step 9, "fewer, task-shaped pages"): six pages, each holding the
// earlier one-task screens as tabs. Pure data and functions with no imports, so the route
// rules load in tests without a browser. Views keep their old keys, so records, links and
// per-tab form drafts are unchanged; only where they sit and how the address reads changed.

/** Every screen, by its view key. A view is one tab of one page. */
export type View =
  | 'chat'
  | 'path'
  | 'overview'
  | 'submit'
  | 'catalog'
  | 'compare'
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
  | 'marketing'
  | 'portfolio'
  | 'models'
  | 'settings'
  | 'github'
  | 'payments';

export type PageKey =
  'chat' | 'projects' | 'sources' | 'monitor' | 'connections' | 'settings';

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
  {
    key: 'sources',
    label: 'Sources',
    sections: [
      { view: 'evidence', slug: 'claims', label: 'Sources and claims' },
      { view: 'catalog', slug: 'library', label: 'Library' },
      { view: 'search', slug: 'search', label: 'Search' },
    ],
  },
  {
    key: 'monitor',
    label: 'Monitor',
    sections: [
      { view: 'overview', slug: 'overview', label: 'Overview' },
      { view: 'decisions', slug: 'approvals', label: 'Approvals' },
      { view: 'runs', slug: 'runs', label: 'Runs' },
      { view: 'activity', slug: 'activity', label: 'Activity' },
      { view: 'budgets', slug: 'budgets', label: 'Budgets' },
      { view: 'operations', slug: 'workers', label: 'Workers' },
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
export function tabsOf(page: Page): { label: string; sections: Section[] }[] {
  const tabs: { label: string; sections: Section[] }[] = [];
  for (const s of page.sections) {
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
