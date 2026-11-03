// Arguments for Try's terminal run. No imports, so tests load it directly.

export function terminalArgs(text: string): string[] {
  return text.split(/\r?\n/).filter((s) => s.length);
}
/**
 * The arguments a terminal run sends. One per line cannot hold an empty or multi-line argument,
 * so "Use these arguments" keeps the spec's exact list, which is sent while the box still shows
 * it; once the owner edits the box, the lines are read again (PR #94 review Low).
 */
export function argsToSend(
  text: string,
  example: { args: string[]; text: string } | null,
): string[] {
  return example && text === example.text ? example.args : terminalArgs(text);
}
/** True when an argument list cannot be shown one per line without losing something. */
export const needsExactArgs = (args: string[]) =>
  args.some((a) => !a.length || /[\r\n]/.test(a));
