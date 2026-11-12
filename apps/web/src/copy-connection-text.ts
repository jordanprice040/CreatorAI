// ADR-0095 (P30): what "Copy to another workspace" offers and says. No imports, so tests load it.

type Ws = { id: string; name: string; role: string; record_mode: string };

/**
 * Workspaces a connection can be copied into: other workspaces the person owns, with the same
 * record mode (fixture or real), by name. The server checks the same and refuses the rest.
 */
export function copyTargets<T extends Ws>(all: readonly T[], from: Ws): T[] {
  return all
    .filter(
      (w) =>
        w.id !== from.id &&
        w.role === 'owner' &&
        w.record_mode === from.record_mode,
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Why nothing can be picked, when no workspace qualifies. */
export function noTargetText(from: Ws): string {
  return from.record_mode === 'fixture'
    ? 'You own no other fixture workspace. A fixture connection is copied only into another fixture workspace.'
    : 'You own no other real workspace. A real connection is copied only into another real workspace.';
}

export type ChatOutcome =
  'copied' | 'not_requested' | 'source_not_using' | 'target_has_own';

/** The steps left in the target, in order, after a copy. */
export function copiedSteps(
  kind: 'chatgpt_plan' | 'claude_code',
  target: string,
  label: string,
  chat: ChatOutcome,
  /** Whether the copied Chat answers setting is on (only read when `chat` is 'copied'). */
  chatOn = false,
): string[] {
  const steps = [
    `Switch to "${target}" with the workspace picker at the top, then open Models and connections › "${label}".`,
    kind === 'claude_code'
      ? 'Check Claude Code there, and confirm extra usage is off.'
      : 'Sign in with ChatGPT there (the sign-in is not shared between workspaces), and confirm credits are off.',
    'Accept the caps and allowed work, then verify the model.',
    'Qualify the model for its tasks there; "Qualify several tasks" does them in one go. Qualifications are not copied.',
  ];
  if (chat === 'copied')
    steps.push(
      chatOn
        ? 'Chat answers there are on and use this connection and model; they start answering once the model is verified. Turn them off there under Chat answers if you did not mean that.'
        : 'Chat answers there now use this connection and model, and are off until you turn them on there.',
    );
  if (chat === 'target_has_own')
    steps.push(
      'That workspace already had its own Chat answers setting, so it was left as it was.',
    );
  return steps;
}

type ChatSetting = {
  enabled: boolean;
  connection_id: string | null;
  model_id: string | null;
  include_snapshot: boolean;
};

/**
 * Review 1 L-2: what copying the Chat answers setting would do in the target, said before Copy
 * is pressed. `null` when Chat answers here do not use this connection (nothing to copy).
 */
export function chatCopyNote(
  here: ChatSetting | null,
  connectionId: string,
): string | null {
  if (!here || here.connection_id !== connectionId) return null;
  if (!here.enabled)
    return `Chat answers are off here. If that workspace has no Chat answers setting yet, it gets this one: off, using the copy${here.model_id ? ` with ${here.model_id}` : ', with no model chosen yet'}.`;
  // On always has a model (the server refuses on without one).
  const model = here.model_id ?? 'the chosen model';
  return `Chat answers are on here. If that workspace has no Chat answers setting yet, Chat answers will be ON there, using the copy with ${model}, as soon as you verify the model there. Each answer then sends the conversation${here.include_snapshot ? " and a snapshot of that workspace's records" : ''} to the model's provider.`;
}
