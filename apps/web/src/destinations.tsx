import { useEffect, useRef, useState } from 'react';
import { DestinationSchema } from '@creator/contracts';
import { ApiError, api, message, words } from './oversight.js';
import { subjectTarget, type View } from './ui.js';

// P01 (R01): one place that decides where an activity subject or search hit opens, used by
// the Activity tab, the sidebar's Recent list and Search. The server checks the subject is
// still in this workspace and follows it to what a page focuses (a task to its workflow, an
// artifact to its newest code version on Try, a selection to its problem's scores); this
// file maps that to a page. Subjects no page focuses by id open their page instead.

/** Subjects that open a page as a whole: no page lists them as single items. */
const PAGE_OF_KIND: Record<string, View> = {
  workflow_task: 'runs',
  build: 'build',
  preview: 'gallery',
  code_version: 'gallery',
  chat_conversation: 'chat',
  chat_settings: 'chat',
  selection: 'scores',
  desktop_device: 'desktop',
  desktop_job: 'desktop',
  desktop_challenge: 'desktop',
  plan_connection: 'models',
  plan_qualification: 'models',
  plan_qualification_queue: 'models',
  model_choice: 'models',
  github_connection: 'github',
  github_repository: 'github',
  github_operation: 'github',
  github_review: 'github',
  github_webhook: 'github',
  payment_connection: 'payments',
  payment_offer: 'payments',
  payment_checkout: 'payments',
  funding_rail: 'payments',
  finance_commitment: 'payments',
  finance_entry: 'payments',
  envelope: 'budgets',
  reservation: 'budgets',
  pricing: 'budgets',
  marketing_campaign: 'marketing',
  portfolio: 'portfolio',
  deployment: 'portfolio',
  earnings_tranche: 'portfolio',
  reinvestment_policy: 'portfolio',
  reinvestment_allocation: 'portfolio',
  reinvestment_loss: 'portfolio',
  study: 'studies',
  evidence_sites: 'settings',
  runtime_limits: 'settings',
  runtime_ceiling: 'settings',
  saved_query: 'search',
};

/** The page and item for a focus the server resolved. */
export function focusTarget(kind: string, id: string): [View, string] | null {
  if (kind === 'code_version') return ['gallery', id];
  if (kind === 'chat_conversation') return ['chat', id];
  if (kind === 'problem_scores') return ['scores', id];
  return subjectTarget(kind, id);
}

/** Whether a subject gets a link at all; others stay plain text rather than a dead link. */
export function canOpen(kind: string): boolean {
  return subjectTarget(kind, '') !== null || kind in PAGE_OF_KIND;
}

/** Why a subject cannot open. Never names the item: its title may be private or gone. */
export function unavailableText(kind: string, state: string): string {
  const what = words(kind);
  if (state === 'redacted')
    return `This ${what} was redacted, so there is nothing left to open. Its history stays in Activity.`;
  return `This ${what} can't be opened: it was deleted, or it isn't in this workspace.`;
}

/**
 * Opens a subject through the server's destination check. A click whose answer arrives after
 * the person moved elsewhere (another page, workspace or click) is dropped, so a slow check
 * never pulls them back. `notice` explains a subject that cannot be opened.
 */
export function useOpenSubject(
  workspace: string,
  open: (view: View, id?: string) => void,
) {
  const [notice, setNotice] = useState<{ key: string; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState('');
  const latest = useRef(0);
  useEffect(() => {
    latest.current += 1;
    setNotice(null);
    setBusy('');
  }, [workspace]);
  async function openSubject(kind: string, id: string, key = `${kind}:${id}`) {
    const ticket = ++latest.current;
    const from = window.location.hash;
    setNotice(null);
    setBusy(key);
    try {
      const d = await api(
        DestinationSchema,
        `workspaces/${workspace}/destination?${new URLSearchParams({ kind, id })}`,
      );
      if (ticket !== latest.current || window.location.hash !== from) return;
      const to = d.focus ? focusTarget(d.focus.kind, d.focus.id) : null;
      if (to) open(to[0], to[1]);
      else if (d.state === 'unchecked' && kind in PAGE_OF_KIND)
        open(PAGE_OF_KIND[kind]!);
      else if (d.state === 'unchecked' && subjectTarget(kind, id))
        open(...subjectTarget(kind, id)!);
      else setNotice({ key, text: unavailableText(kind, d.state) });
    } catch (e) {
      // Review N3: a malformed id is refused as not found; say so in the same words.
      if (ticket === latest.current)
        setNotice({
          key,
          text:
            e instanceof ApiError && e.code === 'NOT_FOUND'
              ? unavailableText(kind, 'missing')
              : message(e),
        });
    } finally {
      if (ticket === latest.current) setBusy('');
    }
  }
  return { openSubject, notice, busy, clear: () => setNotice(null) };
}
