// What the studio says back to a chat message (ADR-0055, first version). Pure rules with no
// imports, so they are tested without a browser. No model writes these: each reply is worked
// out from the message's intent and the workspace's current facts when it is shown. Cards
// only open a tab or fill in a form there; they never start work or approve anything.

export type ChatIntent =
  | 'next'
  | 'why_blocked'
  | 'add_source'
  | 'save_idea'
  | 'start_discovery'
  | 'approvals'
  | 'note';

/** A step of the main path, as next-rules gives it (only what a reply needs). */
export type ReplyStep = {
  tone: 'next' | 'blocked' | 'clear';
  text: string;
  view: string | null;
};

export type ReplyFacts = {
  /** False for an older message of the same kind: its answer would be out of date. */
  latest: boolean;
  /** The path's current step, or null while the facts are still loading or failed to load. */
  step: ReplyStep | null;
  /** The blocked stage of the path, if any. */
  blocked: { label: string; text: string; view: string } | null;
  /** Decisions waiting for the person, or null when not known. */
  pending: number | null;
};

export type ReplyAction =
  | { kind: 'open'; view: string; label: string }
  | { kind: 'fill'; view: 'evidence' | 'submit'; value: string; label: string };

export type Reply = { text: string; actions: ReplyAction[] };

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

const STALE =
  'This was asked earlier, so its answer may be out of date. Ask again for where things stand now.';
const LOADING = 'Reading where this workspace stands…';

export function chatReply(
  intent: ChatIntent,
  target: { url?: string | undefined; text?: string | undefined },
  message: string,
  f: ReplyFacts,
): Reply {
  const path: ReplyAction = {
    kind: 'open',
    view: 'path',
    label: 'Open the path',
  };
  switch (intent) {
    case 'next': {
      if (!f.latest) return { text: STALE, actions: [path] };
      if (!f.step) return { text: LOADING, actions: [path] };
      const lead =
        f.step.tone === 'blocked'
          ? 'Blocked'
          : f.step.tone === 'clear'
            ? 'Nothing needs you right now'
            : 'Next';
      const actions: ReplyAction[] = [];
      if (f.step.view)
        actions.push({ kind: 'open', view: f.step.view, label: 'Go there' });
      actions.push(path);
      return { text: `${lead}: ${f.step.text}`, actions };
    }
    case 'why_blocked': {
      if (!f.latest) return { text: STALE, actions: [path] };
      if (!f.step) return { text: LOADING, actions: [path] };
      if (f.blocked)
        return {
          text: `${f.blocked.label} is blocked. ${f.blocked.text}`,
          actions: [
            { kind: 'open', view: f.blocked.view, label: 'Fix it there' },
            path,
          ],
        };
      return {
        text: `Nothing on the main path is blocked right now. ${f.step.tone === 'clear' ? '' : 'Next: '}${f.step.text}`,
        actions: [path],
      };
    }
    case 'approvals': {
      const approvals: ReplyAction = {
        kind: 'open',
        view: 'decisions',
        label: 'Open Approvals',
      };
      if (!f.latest) return { text: STALE, actions: [approvals] };
      if (f.pending === null) return { text: LOADING, actions: [approvals] };
      return {
        text:
          f.pending === 0
            ? 'Nothing is waiting for you.'
            : `${plural(f.pending, 'decision')} ${f.pending === 1 ? 'waits' : 'wait'} for you. Approving permits exactly the action each one shows.`,
        actions: [approvals],
      };
    }
    case 'add_source':
      return {
        text: `I can put ${target.url} into the fetch form under Sources. Fetching still needs an approved website and an active run, and a fetched page is not a claim until you record one.`,
        actions: [
          {
            kind: 'fill',
            view: 'evidence',
            value: target.url ?? '',
            label: 'Fill in the fetch form',
          },
        ],
      };
    case 'save_idea':
      if (!target.text)
        return {
          text: 'Tell me the idea after "save this idea:" and it stays here in this conversation.',
          actions: [],
        };
      return {
        text: 'Saved here as an idea. Nothing has started. When you want to explore it, use it as the theme of a discovery.',
        actions: [
          {
            kind: 'fill',
            view: 'submit',
            value: target.text,
            label: 'Use as a theme in Discover',
          },
        ],
      };
    case 'start_discovery':
      return {
        text: target.text
          ? 'A discovery starts from Discover, under its own run, budget and approval checks. I can fill in the theme for you; you start it there.'
          : 'What should the discovery be about? Try "Start a discovery about …", or open Discover.',
        actions: [
          target.text
            ? {
                kind: 'fill',
                view: 'submit',
                value: target.text,
                label: 'Fill in the theme',
              }
            : { kind: 'open', view: 'submit', label: 'Open Discover' },
        ],
      };
    case 'note':
      return {
        text: 'Saved as a note. I can\'t answer in words yet; for now I answer "what\'s next", "why is it blocked", "what\'s waiting for me", web addresses, "save this idea: …" and "start a discovery about …".',
        actions: [
          {
            kind: 'fill',
            view: 'submit',
            value: message,
            label: 'Make this a brief',
          },
        ],
      };
  }
}
