// Final UX pass P-7 (ADR-0103): Discover shows one start panel at a time. Pure data and
// functions with no runtime imports, so the rules load in tests without a browser.

export type DiscoverPanel = 'explore' | 'web' | 'claims' | 'theme';

export type PanelChoice = {
  key: DiscoverPanel | 'autopilot';
  label: string;
  text: string;
  /**
   * The choice opens another page instead of a panel here. Run it for me moved to its own
   * Autopilot page (November 15), and Discover keeps the choice so it is found where it was.
   */
  page?: 'autopilot';
};

/** The start choices, in the order the row lists them. */
export const PANEL_CHOICES: readonly PanelChoice[] = [
  {
    key: 'explore',
    label: 'Explore for me',
    text: 'No theme yet: the studio looks for problems in your recorded evidence.',
  },
  {
    key: 'web',
    label: 'Search the web',
    text: 'Find new evidence online: checked quotes from real pages become claims.',
  },
  {
    key: 'claims',
    label: 'Discover from claims',
    text: 'You know the problem: write a short brief and start a run now.',
  },
  {
    key: 'autopilot',
    label: 'Run it for me',
    text: 'Opens the Autopilot page: it takes the steps for you and stops where a person must decide.',
    page: 'autopilot',
  },
  {
    key: 'theme',
    label: 'Start with a theme',
    text: 'A rough idea saved as a draft to plan later.',
  },
];

/** Section 6 of the findings: the theme draft is an older, expert start, listed in Advanced. */
export const ADVANCED_PANELS: readonly DiscoverPanel[] = ['theme'];

/** The choices listed in this view mode; the open one is always kept. */
export function panelsFor(
  standard: boolean,
  open?: DiscoverPanel,
): PanelChoice[] {
  return PANEL_CHOICES.filter(
    (c) =>
      !standard ||
      c.key === open ||
      !ADVANCED_PANELS.includes(c.key as DiscoverPanel),
  );
}

/** The panel to open first: this browser's last choice when it is still listed, else Explore. */
export function firstPanel(
  saved: string | null,
  standard: boolean,
): DiscoverPanel {
  const listed = panelsFor(standard).filter((c) => !c.page);
  return (listed.find((c) => c.key === saved)?.key ??
    'explore') as DiscoverPanel;
}

/** This browser's last open panel, per person and workspace. */
export const panelKey = (actor: string, ws: string) =>
  `creator.discoverPanel.${actor}.${ws}`;

export const isPanel = (v: string | undefined): v is DiscoverPanel =>
  PANEL_CHOICES.some((c) => c.key === v && !c.page);
