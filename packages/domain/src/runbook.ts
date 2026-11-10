import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import {
  ContractError,
  PROPOSAL_SECTIONS,
  PROPOSAL_SECTION_LABELS,
  RUNBOOK_FORMAT,
  RUNBOOK_MAX_BYTES,
  RUNBOOK_MAX_FILES,
  RunbookManifestSchema,
  specRecipe,
  type ProposalBody,
  type ProposalChecks,
  type ProposalReference,
  type RunbookManifest,
  type RunbookPrompt,
  type SpecContent,
} from '@creator/contracts';
import {
  RESPONSE_WORDS,
  inlineText,
  proposalMarkdown,
  urlText,
} from './proposal.js';
import { validateSpec } from './selection.js';

// ADR-0080 (P16). An implementation runbook for a separate coding model or person, built by
// application code from one saved spec or proposal version and the records it follows. No model
// writes it, nothing in it says the work was done, and it must read without the studio:
// every link stays inside the bundle. Held-out acceptance cases are never included, and
// anything shaped like a credential or a personal folder path is removed first.

export interface RunbookFile {
  path: string;
  content: Buffer;
}

// ---- Redaction ---------------------------------------------------------------------------

const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abeoprs]-[A-Za-z0-9-]{10,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /\bwhsec_[A-Za-z0-9]{16,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g,
  // Starts only where a scheme can start, so a long dotted or hyphenated run is scanned once
  // (re-review 4, R4-1).
  // The user name may be empty ("redis://:pw@host") (re-review 5, R5-2). The password first
  // stops at quotes, backticks, "<>" and "|", so JSON or a table after the address stays; only
  // when that finds no "@" does it run to the last "@" before a "/" or a space, which also
  // catches a raw "@" in it (re-review 6, R6-1). A quote or backtick stays inside the first
  // run unless structure follows it, so "P@ss'w0rd@db" is removed whole (re-review 7, R7-1).
  /(?<![a-z0-9+.-])[a-z0-9+.-]+:\/\/[^\s/:@]*:(?:(?:[^\s/"'`<>|]|["'`](?![\s,;:)\]}>|]|$))+@|[^\s/@]+@)/gi,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bhf_[A-Za-z0-9]{30,}/g,
  /\bnpm_[A-Za-z0-9]{36,}/g,
  /\bBasic\s+(?=[A-Za-z0-9+/]*[0-9+/=])[A-Za-z0-9+/]{16,}=*/g,
];
/** A personal folder: the account name is the private part, so it and the rest are dropped. */
// The account name may hold up to three more words joined by ordinary spaces ("Jordan Price",
// "José García", "Mary Ann Van Dyke", "O'Brien"), but only when what follows the separator is
// clearly more path: a profile folder, a segment followed by another separator, a file name
// with an extension, a last segment that ends the text or line or is followed by a closing
// quote, backtick or bracket, a comma or semicolon, or a separator followed by a space, quote,
// bracket or the end. So "/home/ci Linux/macOS only" keeps its words. Windows paths match in
// any letter case. A lower-case macOS "/users/name" counts only before a profile folder, so a
// web route such as "/users/me" is kept.
const NAME_SEG = `(?:[^\\\\/\\s"'\`<>|:*?]|'(?=\\p{L}))+`;
const UNIX_NAME_SEG = `(?:[^/\\s"'\`<>]|'(?=\\p{L}))+`;
const anyCase = (w: string) =>
  w.replace(/[A-Za-z]/g, (c) => `[${c.toUpperCase()}${c.toLowerCase()}]`);
const PROFILE_FOLDER_NAMES = [
  'Desktop',
  'Documents',
  'Downloads',
  'AppData',
  'OneDrive',
  'Pictures',
  'Music',
  'Videos',
  'Library',
  'Favorites',
  'Contacts',
  'Links',
  'Saved Games',
  'Searches',
];
const PROFILE_FOLDERS = PROFILE_FOLDER_NAMES.map(anyCase).join('|');
const PROFILE = `(?:${PROFILE_FOLDERS})(?![\\p{L}\\p{N}])`;
// The lower-case macOS arm needs the folder in its real spelling, so a web route such as
// "/users/{id}/links" or "/users/me/library" is not taken for a profile (re-review 4, R4-2).
const MAC_PROFILE = `(?:${PROFILE_FOLDER_NAMES.join('|')})(?![\\p{L}\\p{N}])`;
// Closing marks after a path: quotes (straight and curly), a backtick, brackets, Markdown
// emphasis and a table bar.
const CLOSE = `["'\`)\\]}>*~|”’»]`;
// A last segment cannot hold a closing bracket, and each part below can match a character in
// only one way, so a long run of brackets is scanned in linear time (re-review 3, R3-1).
const LAST_SEG = `[^\\\\/\\s"'\`<>|:*?)\\]}~”’»]+`;
const MORE_PATH = [
  PROFILE,
  `\\.[\\w-]+`,
  `${NAME_SEG}[\\\\/]`,
  `[^\\\\/\\s"'\`<>|:*?.]+\\.[A-Za-z0-9]{1,8}(?![\\p{L}\\p{N}])`,
  // One last segment that ends the text or the line, after optional closing quotes or
  // brackets and one sentence mark.
  `${LAST_SEG}${CLOSE}*(?:[.,;:!?]${CLOSE}*)?(?:$|\\r?\\n)`,
  // One last segment closed by a quote, backtick or bracket (a code span), or followed by a
  // sentence mark and a space (re-review 7, R7-2).
  `${LAST_SEG}(?:${CLOSE}|[.,;:!?](?=\\s))`,
  // ...or ended by Markdown emphasis "_" before a space, a sentence mark or the end.
  `[^\\\\/\\s"'\`<>|:*?)\\]}~”’»_]+(?:_+[^\\\\/\\s"'\`<>|:*?)\\]}~”’»_]+)*_+(?=[\\s.,;:!?]|$)`,
  // Nothing but a separator: "…\Jordan Price\ in Explorer", "…\Jordan Price\".
  `(?:$|\\s|${CLOSE})`,
].join('|');
const MORE_WORDS = `(?:(?:[ \\t]+[\\p{L}\\p{N}][\\p{L}\\p{M}\\p{N}'.-]*){1,3}(?=[\\\\/]+(?:${MORE_PATH})))?`;
const UNIX_MORE_WORDS = MORE_WORDS.replaceAll('[\\\\/]', '\\/');
// The account name ends on a closer or sentence mark only when a separator follows, so
// "(see /home/jordan)." keeps its ")." (re-review 7, R7-N1).
const PATH_PATTERNS: readonly RegExp[] = [
  new RegExp(
    `(?:(?<![A-Za-z0-9])[A-Za-z]:|\\\\\\\\${NAME_SEG})[\\\\/]+Users[\\\\/]+${NAME_SEG}(?:(?<![).\\]}~”’».,;!])|(?=[\\\\/]))${MORE_WORDS}(?:[\\\\/]+(?:[^\\s"'\`<>|*?]*[^\\s"'\`<>|*?)\\]}~”’».,;:!])?)?`,
    'giu',
  ),
  new RegExp(
    `(?<![A-Za-z0-9.-])(?:\\/home|\\/Users|\\/mnt\\/[A-Za-z]\\/${anyCase('Users')})\\/${UNIX_NAME_SEG}(?:(?<![)\\]}~”’».,;:!*|])|(?=\\/))${UNIX_MORE_WORDS}(?:\\/(?:[^\\s"'\`<>]*[^\\s"'\`<>)\\]}~”’»*|.,;:!?])?)?`,
    'gu',
  ),
  new RegExp(
    `(?<![A-Za-z0-9.-])\\/${anyCase('users')}\\/(?![{:]|me\\/|\\d+\\/)${UNIX_NAME_SEG}${UNIX_MORE_WORDS}\\/${MAC_PROFILE}(?:\\/(?:[^\\s"'\`<>]*[^\\s"'\`<>)\\]}~”’»*|.,;:!?])?)?`,
    'gu',
  ),
];
export const REDACTED_SECRET = '[credential removed]';
export const REDACTED_PATH = '[private path removed]';

export interface Redactions {
  secrets: number;
  paths: number;
}
/** One text with credentials and personal folder paths replaced; `count` is added to. */
export function redactText(text: string, count: Redactions): string {
  let out = text;
  for (const p of SECRET_PATTERNS)
    out = out.replace(p, () => {
      count.secrets++;
      return REDACTED_SECRET;
    });
  for (const p of PATH_PATTERNS)
    out = out.replace(p, () => {
      count.paths++;
      return REDACTED_PATH;
    });
  return out;
}
/** Every string of a JSON-like value redacted; keys, numbers and shape are kept. */
function redactDeep<T>(value: T, count: Redactions): T {
  if (typeof value === 'string') return redactText(value, count) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, count)) as T;
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redactDeep(v, count)]),
    ) as T;
  return value;
}

// ---- Text helpers ------------------------------------------------------------------------

const sha256 = (b: Buffer | string) =>
  createHash('sha256').update(b).digest('hex');
const oneLine = (s: string) => s.replace(/[\p{Cc}\u2028\u2029]+/gu, ' ').trim();
const two = (n: number) => String(n).padStart(2, '0');
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;
/** Text kept exactly, in a block nothing inside it can close. */
function fenced(text: string, lang = 'text'): string {
  const body = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  const longest = Math.max(
    0,
    ...[...body.matchAll(/`+/g)].map((m) => m[0].length),
  );
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${lang}\n${body}\n${fence}`;
}
/** One-line text as a code span that nothing inside it can close. */
function code(text: string): string {
  const body = oneLine(text);
  const longest = Math.max(
    0,
    ...[...body.matchAll(/`+/g)].map((m) => m[0].length),
  );
  const tick = '`'.repeat(longest + 1);
  return longest ? `${tick} ${body} ${tick}` : `${tick}${body}${tick}`;
}
function slug(title: string, fallback: string): string {
  const out = title
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
    .toLowerCase();
  // A file name must never look like a credential ("sk-learn-pipeline-for-cleaning"): the
  // bundle's own scan would refuse it. Words stay readable with the prefix joined on.
  const safe = out.replace(/\b(sk|xox[abeoprs]|glpat)-/g, '$1');
  const n: Redactions = { secrets: 0, paths: 0 };
  redactText(safe, n);
  return n.secrets || n.paths ? fallback : safe || fallback;
}
/** A safe archive name; the subject's version is in it. */
export function runbookFileName(title: string, version: number): string {
  return `${slug(title, 'project')}-runbook-v${version}.zip`;
}
const bullets = (items: readonly string[], empty: string) =>
  items.length ? items.map((i) => `- ${inlineText(i)}`) : [empty];

// ---- Inputs ------------------------------------------------------------------------------

interface Ref {
  id: string;
  version: number;
}
export interface RunbookSelection {
  id: string;
  created_at: string;
  /** False when a later selection for the problem replaced it. */
  current: boolean;
  rationale: string;
  /** What the selection decided for this option; null when it does not mention it. */
  disposition: string | null;
  reasons: readonly string[];
  reverse_if: string | null;
}
export interface RunbookOption extends Ref {
  kind: string;
  title: string;
  rationale: string;
  tradeoffs: readonly string[];
  uncertainty: string;
  /** The option's version now; differs from `version` when it changed after the spec. */
  current_version: number | null;
}
export interface RunbookProblem extends Ref {
  title: string;
  statement: string;
  affected_group: string;
}
export interface RunbookHumility extends Ref {
  /** The subject version the review judged. */
  subject_version: number;
  disposition: string;
  software_part: string;
  human_part: string;
  burden_risks: readonly string[];
  disconfirming_test: string;
  change_course_trigger: string;
  rationale: string;
  /** none_identified, resolved or unresolved_serious. */
  ethical_status: string;
  ethical_note: string;
  dissent: readonly string[];
  /** The studio's own pre-build gate for this review and this spec version. */
  build_admissible: boolean;
  /** The gate's only objection is unresolved ethics: the owner's judgement is needed. */
  needs_judgment: boolean;
  /** Why the gate says no; empty when it admits a build. */
  gate_reasons: readonly string[];
}
export interface SoftwareRunbookInput {
  spec: Ref & {
    title: string;
    content_hash: string;
    saved_at: string;
    content: SpecContent;
  };
  /** The freeze of exactly this version, if any. */
  freeze: { id: string; frozen_at: string; content_hash: string } | null;
  /** The newest frozen version of the spec, whichever it is. */
  latest_frozen_version: number | null;
  problem: RunbookProblem | null;
  option: RunbookOption;
  selection: RunbookSelection;
  humility: RunbookHumility | null;
  /** Active claims linked to the problem, labelled R1, R2, ... */
  references: readonly ProposalReference[];
  /** Linked claims left out because only the first 60 are listed. */
  references_omitted: number;
}
export interface ActionRunbookInput {
  proposal: Ref & {
    title: string;
    content_hash: string;
    saved_at: string;
    body: ProposalBody;
    /** The document checks of this version, with the claims it cites. */
    checks: ProposalChecks;
    /** Titles as the proposal's own Markdown export shows them. */
    problem_title: string;
    option_title: string;
  };
  problem: RunbookProblem | null;
  option: RunbookOption;
  selection: RunbookSelection;
}

// ---- Shared sections ---------------------------------------------------------------------

const DISPOSITION_WORDS: Record<string, string> = {
  select_for_build: 'selected for a build',
  proceed_to_validation: 'to be validated before any build',
  recommend_alternative: 'recommended instead of building software',
  research_further: 'needs more research',
  defer: 'deferred',
  reject: 'rejected',
};
const kindWords = (k: string) => RESPONSE_WORDS[k] ?? k.replaceAll('_', ' ');

function evidenceFile(
  references: readonly ProposalReference[],
  omitted: number,
): string {
  const out = [
    '# Evidence',
    '',
    'These are the claims recorded for the problem, with the sources that back or dispute them. They were copied from the studio when this bundle was made. A claim is what the records say, not a proven fact; check a source yourself before relying on it. Quotes are short excerpts; the full sources are not in this bundle.',
    '',
  ];
  const group = (title: string, rs: readonly ProposalReference[]) => {
    out.push(`## ${title}`, '');
    if (!rs.length) out.push('None recorded.', '');
    for (const r of rs) {
      out.push(
        `- **[${r.label}]** ${inlineText(r.statement)} (claim ${r.claim.id.slice(0, 8)}, version ${r.current_version ?? r.claim.version}; evidence status: ${inlineText(r.status)})`,
      );
      for (const s of r.sources)
        out.push(
          `  - ${inlineText(s.title).trim() ? `${inlineText(s.title)}: ` : ''}${urlText(s.url)} (${inlineText(s.stance)}, ${inlineText(s.freshness)})${s.quote ? ` — “${inlineText(s.quote)}”` : ''}`,
        );
      if (!r.sources.length) out.push('  - No source is attached.');
    }
    if (rs.length) out.push('');
  };
  group(
    'Supporting',
    references.filter((r) => r.relation === 'supports'),
  );
  group(
    'Contrary',
    references.filter((r) => r.relation === 'contradicts'),
  );
  const other = references.filter((r) => r.relation === 'not_linked');
  if (other.length) group('Cited, not linked to the problem', other);
  if (!references.some((r) => r.relation === 'contradicts'))
    out.push(
      'No contrary claim is recorded. That does not show there is none.',
      '',
    );
  if (omitted > 0)
    out.push(
      `${plural(omitted, 'more linked claim')} ${omitted === 1 ? 'is' : 'are'} not listed here; only the first ${references.length} are.`,
      '',
    );
  return out.join('\n');
}

function decisionLines(
  selection: RunbookSelection,
  option: RunbookOption,
): string[] {
  const out = [
    `- **Selection** (${selection.created_at.slice(0, 10)}, id ${selection.id.slice(0, 8)}): “${inlineText(option.title)}” (${kindWords(option.kind)}) was ${selection.disposition ? (DISPOSITION_WORDS[selection.disposition] ?? inlineText(selection.disposition)) : 'not mentioned in this selection'}.`,
  ];
  for (const r of selection.reasons) out.push(`  - Reason: ${inlineText(r)}`);
  if (selection.rationale)
    out.push(`  - Rationale: ${inlineText(selection.rationale)}`);
  if (selection.reverse_if)
    out.push(
      `  - It would be reversed if: ${inlineText(selection.reverse_if)}`,
    );
  if (!selection.current)
    out.push(
      '  - **A later selection replaced this one.** Check with the owner before starting.',
    );
  return out;
}

const RECOVERY = (kind: 'software' | 'action') =>
  [
    '# When something fails',
    '',
    'Use this whenever a gate does not pass, a step cannot be finished, or the bundle and reality disagree.',
    '',
    '1. **Stop at the failing step.** Do not start a later prompt; its prerequisites are not met.',
    kind === 'software'
      ? '2. **Read the failure exactly.** Keep the command, its output and the check key (for example A2). Do not guess from memory.'
      : '2. **Write down what happened**: the step, who did it, what was expected and what was seen.',
    kind === 'software'
      ? '3. **Repair inside the task’s scope.** Change only the files the task may change. If the fix needs another file, the task plan is wrong: stop and ask the owner.'
      : '3. **Do not improvise a different plan.** If a step cannot be done as written, ask the owner which change to make.',
    kind === 'software'
      ? '4. **Run the same check again**, then every check that passed before. A fix that breaks an earlier check is not a fix.'
      : '4. **Repeat the step only when the cause is understood**, and note that it was repeated.',
    kind === 'software'
      ? '5. **After three failed repairs of the same check, stop.** Report the check, the three attempts and their output to the owner.'
      : '5. **After two failed tries, stop** and report to the owner.',
    '6. **Never change a requirement, an acceptance check or its expected output to get a pass.** They are fixed in this bundle. If one looks wrong, say so in your report and leave it as it is.',
    '7. **If the bundle is missing something you need** (a decision, data, an account, a credential), do not invent it. List it as a blocker. Nothing in this bundle grants access to anything.',
    kind === 'software'
      ? '8. **If the workspace is broken** (lost files, a bad merge), return to the last commit whose gate passed and replay the prompts after it.'
      : '8. **If something could harm a person or their data**, stop the step first and report second.',
    '',
    'A report of a failure is a good result. A pass that was not observed is not.',
    '',
  ].join('\n');

interface Draft {
  path: string;
  text: string;
}
interface PromptDraft {
  step: RunbookPrompt['step'];
  title: string;
  task: string | null;
  /** Indexes into the prompt list. */
  needs: number[];
  scope: string[];
  artifacts: string[];
  gate: string[];
  body: string[];
  slug: string;
}
function promptFiles(
  prompts: readonly PromptDraft[],
  contractName: string,
): { files: Draft[]; listed: RunbookPrompt[] } {
  const paths = prompts.map((p, i) => `prompts/${two(i + 1)}-${p.slug}.md`);
  const base = (p: string) => p.slice('prompts/'.length);
  const files = prompts.map((p, i) => {
    const text = [
      `# Prompt ${two(i + 1)} — ${inlineText(p.title)}`,
      '',
      `Paste the whole of [${contractName}](../${contractName}) first, then the block under “Prompt” below, into a fresh session.`,
      '',
      '## Prerequisites',
      '',
      ...(p.needs.length
        ? p.needs.map(
            (n) =>
              `- [Prompt ${two(n + 1)}](${base(paths[n]!)}) passed its completion gate.`,
          )
        : ['- None. This is the first step.']),
      '',
      '## Scope',
      '',
      ...p.scope.map((s) => `- ${s}`),
      '',
      '## Expected artifacts',
      '',
      ...p.artifacts.map((s) => `- ${s}`),
      '',
      '## Completion gate',
      '',
      ...p.gate.map((s) => `- ${s}`),
      '',
      `If the gate does not pass, follow [RECOVERY.md](../RECOVERY.md).`,
      '',
      '## Prompt',
      '',
      fenced(p.body.join('\n')),
      '',
    ].join('\n');
    return { path: paths[i]!, text };
  });
  const listed = prompts.map((p, i) => ({
    order: i + 1,
    path: paths[i]!,
    step: p.step,
    title: oneLine(p.title).slice(0, 400),
    task: p.task,
    prerequisites: p.needs.map((n) => paths[n]!),
  }));
  return { files, listed };
}

function finish(
  drafts: readonly Draft[],
  manifest: Omit<RunbookManifest, 'files' | 'bundle_hash' | 'format'>,
): { files: RunbookFile[]; manifest: RunbookManifest } {
  const files = drafts
    .map((d) => ({
      path: d.path,
      content: Buffer.from(d.text.endsWith('\n') ? d.text : `${d.text}\n`),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  const listed = files.map((f) => ({
    path: f.path,
    bytes: f.content.length,
    sha256: sha256(f.content),
  }));
  const full = RunbookManifestSchema.parse({
    format: RUNBOOK_FORMAT,
    ...manifest,
    files: listed,
    bundle_hash: bundleHash(listed),
  });
  const all = [
    ...files,
    {
      path: 'manifest.json',
      content: Buffer.from(`${JSON.stringify(full, null, 2)}\n`),
    },
  ];
  if (all.reduce((n, f) => n + f.content.length, 0) > RUNBOOK_MAX_BYTES)
    throw new ContractError(
      'INVALID_CONTRACT',
      'The runbook would be larger than the export limit.',
    );
  const problems = validateRunbook(all);
  if (problems.length)
    throw new ContractError(
      'INVALID_CONTRACT',
      `The runbook was not exported because it failed its own checks: ${problems.join(' ')}`.slice(
        0,
        900,
      ),
    );
  return { files: all, manifest: full };
}
const HASH_NOTE =
  '- [manifest.json](manifest.json): versions and a SHA-256 hash of every file. To check the bundle with any tool: each listed file’s SHA-256 must equal its `sha256`, and `bundle_hash` is the SHA-256 of one line per listed file, in the listed order, made of the path, one space, the file’s hash and a line feed.';
const bundleHash = (files: readonly { path: string; sha256: string }[]) =>
  sha256(files.map((f) => `${f.path} ${f.sha256}\n`).join(''));

// ---- Software runbook (from a spec) ------------------------------------------------------

const STACKS: Record<
  'python-build/1' | 'static-web/1',
  { name: string; lines: string[]; run: string }
> = {
  'python-build/1': {
    name: 'Python command-line program (standard library only)',
    lines: [
      'Python 3, standard library only. No packages to install and no network at run time.',
      'The entry point is `src/main.py`. Each check runs it as `python3 -I src/main.py <arguments>` from the project root, with the case’s standard input.',
      '`python3 -I` ignores `PYTHON*` variables and does not put the script’s folder on the import path, so `src/main.py` must add its own folder to `sys.path` before importing local modules.',
      'A case passes when standard output matches byte for byte (including line ends) and the exit code matches.',
      'Each run starts fresh: do not rely on files or state left by an earlier run.',
      'The cases were written for Linux, where the owner’s own check runs: line ends are a single `\\n` and the command is `python3`. On Windows the command is usually `python` or `py -3`, and a program must write `\\n` itself (for example `sys.stdout.reconfigure(newline="\\n")`), or every case fails on the line end.',
      'Running Python can leave `__pycache__` folders behind. The bundled script adds `-B` so its runs write none, and the setup step adds a `.gitignore` for them; never commit one.',
    ],
    run: 'python3 checks/run_checks.py',
  },
  'static-web/1': {
    name: 'Static web page (plain HTML, CSS and JavaScript)',
    lines: [
      'Plain HTML, CSS and JavaScript under `site/`; `site/index.html` is the entry page. No packages, CDNs, build step or network requests outside the site.',
      'A browser case opens one page, runs its steps in order and stays on that document: no dialogs (alert, confirm, prompt), no popups, no navigation to another document. Show messages in the page and handle form submits in script.',
      'A selector must match exactly one element. “expect text” compares the element’s visible text with whitespace collapsed, exactly; “expect contains” checks a substring.',
      'Storage such as localStorage starts empty in every case. An uncaught page error fails the case.',
      'Serve `site/` from a local web server to try it (for example `python3 -m http.server --directory site 8000`).',
    ],
    run: 'follow each browser case in REQUIREMENTS.md by hand or with a browser test tool of your choice',
  },
};

const METHOD_WORDS: Record<string, string> = {
  automated_test: 'automated test',
  browser_check: 'browser check',
  manual_review: 'manual review',
  metric: 'metric',
};
const ROLE_WORDS: Record<string, string> = {
  builder: 'builder (writes the code)',
  reviewer: 'reviewer (reads the work, changes nothing)',
  qa: 'QA (runs the checks)',
  designer: 'designer',
  owner: 'owner (a person, not a coding model)',
};

function stepWords(s: Record<string, unknown>): string {
  const sel = typeof s.selector === 'string' ? s.selector : '';
  const q = (v: unknown) => JSON.stringify(String(v ?? ''));
  switch (s.action) {
    case 'click':
      return `click ${sel}`;
    case 'check':
      return `tick ${sel}`;
    case 'fill':
      return `clear ${sel} and type ${q(s.value)}`;
    case 'select':
      return `in ${sel} choose the option with value ${q(s.value)}`;
    case 'press':
      return `focus ${sel} and press ${String(s.key)}`;
    case 'goto':
      return `change the address hash to ${q(s.path)}`;
    case 'expect_text':
      return `expect ${sel} to show exactly ${q(s.text)}`;
    case 'expect_contains':
      return `expect ${sel} to contain ${q(s.text)}`;
    case 'expect_visible':
      return `expect ${sel} to be visible`;
    case 'expect_hidden':
      return `expect ${sel} to be hidden or absent`;
    case 'expect_count':
      return `expect ${String(s.count)} element(s) to match ${sel}`;
    case 'expect_title':
      return `expect the page title to be ${q(s.text)}`;
    default:
      return String(s.action);
  }
}

/** Tasks in an order that respects depends_on; ties keep the spec's order. */
export function taskOrder(content: SpecContent): SpecContent['tasks'] {
  const left = [...content.tasks];
  const done = new Set<string>();
  const out: SpecContent['tasks'] = [];
  while (left.length) {
    const i = left.findIndex((t) => t.depends_on.every((d) => done.has(d)));
    if (i === -1)
      throw new Error('The spec’s tasks depend on each other in a circle.');
    const [t] = left.splice(i, 1);
    done.add(t!.key);
    out.push(t!);
  }
  return out;
}

/** The runner shipped in a software bundle. It reads only checks/acceptance.json. */
const RUN_CHECKS = `#!/usr/bin/env python3
"""Run this bundle's visible command-line acceptance cases against your program.

Usage, from the project root (the folder that holds src/):
    python3 path/to/checks/run_checks.py [--task T1] [--check A1]
        [--cmd "python3 -I src/main.py"] [--root .]

Each case runs the command plus the case's arguments with the case's standard input.
A case passes when standard output and the exit code both match exactly.
Browser and manual checks are listed but not run. Exit status: 0 all run cases
passed, 1 a case failed, 2 nothing could be run.
"""
import argparse
import json
import os
import shlex
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\\n")[0])
    ap.add_argument("--task")
    ap.add_argument("--check")
    ap.add_argument("--cmd", default=None)
    ap.add_argument("--root", default=".")
    ap.add_argument("--timeout", type=float, default=10.0)
    args = ap.parse_args()
    with open(os.path.join(HERE, "acceptance.json"), encoding="utf-8") as f:
        data = json.load(f)
    cmd = shlex.split(args.cmd) if args.cmd else [sys.executable, "-I", "-B", "src/main.py"]
    wanted = None
    if args.task:
        tasks = [t for t in data["tasks"] if t["key"] == args.task]
        if not tasks:
            print("No task %s in this bundle." % args.task)
            return 2
        wanted = set(tasks[0]["acceptance"])
    ran = failed = skipped = 0
    for check in data["checks"]:
        key = check["key"]
        if wanted is not None and key not in wanted:
            continue
        if args.check and key != args.check:
            continue
        cases = check.get("cases") or []
        if not cases:
            skipped += 1
            print("SKIP %s (%s): %s" % (key, check["method"], check["not_run_reason"]))
            continue
        for i, case in enumerate(cases, 1):
            ran += 1
            label = "%s case %d" % (key, i)
            try:
                p = subprocess.run(
                    cmd + case["args"],
                    input=case["stdin"].encode("utf-8"),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    cwd=args.root,
                    timeout=args.timeout,
                )
            except subprocess.TimeoutExpired:
                failed += 1
                print("FAIL %s: no result after %s s" % (label, args.timeout))
                continue
            except OSError as e:
                failed += 1
                print("FAIL %s: could not start the command: %s" % (label, e))
                continue
            out = p.stdout.decode("utf-8", "replace")
            if out == case["stdout"] and p.returncode == case["exit_code"]:
                print("PASS %s" % label)
                continue
            failed += 1
            print("FAIL %s" % label)
            print("  arguments:        %r" % (case["args"],))
            if p.returncode != case["exit_code"]:
                print("  exit code:        expected %d, got %d" % (case["exit_code"], p.returncode))
            if out != case["stdout"]:
                print("  expected output:  %r" % case["stdout"])
                print("  actual output:    %r" % out)
            err = p.stderr.decode("utf-8", "replace").strip()
            if err:
                print("  standard error:   %r" % err[-600:])
    held = data.get("held_out_cases_withheld", 0)
    print("")
    print("%d run, %d failed, %d check(s) not run by this script." % (ran, failed, skipped))
    if held:
        print(
            "%d held-out case(s) are not in this bundle; the owner runs them. "
            "Passing here does not show they pass." % held
        )
    if failed:
        return 1
    return 0 if ran else 2


if __name__ == "__main__":
    sys.exit(main())
`;

/** A self-contained runbook for building the software a spec describes. */
export function softwareRunbook(raw: SoftwareRunbookInput): {
  files: RunbookFile[];
  manifest: RunbookManifest;
} {
  const count: Redactions = { secrets: 0, paths: 0 };
  const input = redactDeep(raw, count);
  const { spec, option, selection, problem, humility } = input;
  const c = spec.content;
  const graph = validateSpec(c);
  if (graph.length)
    throw new ContractError(
      'INVALID_CONTRACT',
      `The spec’s task plan has problems: ${graph.map((p) => p.detail).join(' ')}`.slice(
        0,
        900,
      ),
    );
  const tasks = taskOrder(c);
  const recipeRaw = specRecipe(c);
  const buildable = c.tasks.some((t) => {
    const checks = c.acceptance_checks.filter((a) =>
      t.acceptance.includes(a.key),
    );
    return (
      checks.length > 0 &&
      (checks.every((a) => a.method === 'automated_test' && a.cases) ||
        checks.every((a) => a.method === 'browser_check' && a.browser_cases))
    );
  });
  const recipe: RunbookManifest['recipe'] = !buildable ? 'none' : recipeRaw;
  const stack =
    recipe === 'python-build/1' || recipe === 'static-web/1'
      ? STACKS[recipe]
      : null;

  // Acceptance checks without their held-out cases; the count is all that leaves the studio.
  let heldOut = 0;
  const checks = c.acceptance_checks.map((a) => {
    const cases = (a.cases ?? []).filter((x) => !x.held_out);
    const browser = (a.browser_cases ?? []).filter((x) => !x.held_out);
    const withheld =
      (a.cases?.length ?? 0) -
      cases.length +
      ((a.browser_cases?.length ?? 0) - browser.length);
    heldOut += withheld;
    return {
      key: a.key,
      flow: a.flow,
      statement: a.statement,
      measure: a.measure,
      method: a.method,
      cases: cases.map(({ held_out: _h, ...x }) => x),
      browser_cases: browser.map(({ held_out: _h, ...x }) => x),
      held_out_cases_withheld: withheld,
    };
  });
  const checkOf = new Map(checks.map((a) => [a.key, a]));
  const hasCli = checks.some((a) => a.cases.length > 0);

  const warnings: string[] = [];
  if (!input.freeze)
    warnings.push(
      input.latest_frozen_version
        ? `This is version ${spec.version} of the spec, which is not frozen (version ${input.latest_frozen_version} is). Its requirements may still change.`
        : 'This spec version is not frozen. Its requirements may still change.',
    );
  if (!selection.current)
    warnings.push(
      'A later selection for the problem replaced the one this spec follows.',
    );
  if (option.current_version !== option.version)
    warnings.push(
      option.current_version === null
        ? 'The selected option is no longer active.'
        : `The selected option changed after this spec was written (version ${option.version}, now ${option.current_version}).`,
    );
  if (!input.references.length)
    warnings.push('No evidence claim is linked to the problem.');
  if (!stack)
    warnings.push(
      recipe === 'mixed'
        ? 'The spec mixes command-line and browser tasks, so no single supported stack fits; the stack for each part is an open decision.'
        : 'No task has executable acceptance cases, so the bundle proposes no stack and has no automatic check runner.',
    );
  if (heldOut)
    warnings.push(
      `${plural(heldOut, 'held-out acceptance case')} ${heldOut === 1 ? 'is' : 'are'} not in this bundle; the owner keeps ${heldOut === 1 ? 'it' : 'them'} to test the result.`,
    );
  if (count.secrets || count.paths)
    warnings.push(
      `${plural(count.secrets, 'credential-like value')} and ${plural(count.paths, 'personal folder path')} were removed. A check whose case contained one will not reproduce.`,
    );
  // The studio starts no build without a review that admits one; the bundle must not look
  // readier than the studio's own gate says.
  // The only problem is unresolved ethics: the gate asks the owner for a judgement rather than
  // refusing outright.
  const ethicsOnly =
    !!humility && !humility.build_admissible && humility.needs_judgment;
  if (!humility)
    warnings.push(
      'No should-this-be-software (humility) review of this spec is recorded. The studio would not start a build without one.',
    );
  else if (!humility.build_admissible)
    warnings.push(
      ethicsOnly
        ? 'The should-this-be-software (humility) review records a serious ethical problem as unresolved. The studio starts a build only after the owner gives an ethical judgement.'
        : `The should-this-be-software (humility) review does not clear a build: ${humility.gate_reasons.map(oneLine).join(' ') || 'it is not admissible.'} The studio would not start one.`,
    );
  if (c.data_contracts.some((d) => d.data_class === 'private_approved'))
    warnings.push(
      'The spec names approved private data. The visible case inputs and outputs are exported as written and were not checked for it; read them before the bundle leaves your hands.',
    );

  const frozenWords = input.freeze
    ? `frozen on ${input.freeze.frozen_at.slice(0, 10)} (freeze ${input.freeze.id.slice(0, 8)})`
    : 'NOT frozen';
  const title = oneLine(spec.title);

  // ---- REQUIREMENTS.md
  const req: string[] = [
    `# Requirements — ${inlineText(title)}`,
    '',
    `Spec ${spec.id}, version ${spec.version}, ${frozenWords}. Content hash \`${spec.content_hash}\`.`,
    '',
    input.freeze
      ? 'These requirements are fixed. Do not change them; report a requirement that looks wrong.'
      : '**These requirements are a draft.** The owner has not frozen them, so confirm them before building.',
    '',
    '## Who it is for',
    '',
    inlineText(c.audience),
    '',
    '## Problem',
    '',
    fenced(c.problem_statement),
    '',
    '## User flows',
    '',
  ];
  for (const f of c.user_flows) {
    req.push(`### ${f.key} — ${inlineText(f.name)}`, '');
    f.steps.forEach((s, i) => req.push(`${i + 1}. ${inlineText(s)}`));
    req.push('');
  }
  req.push('## In scope', '', ...bullets(c.scope, 'Nothing listed.'), '');
  req.push(
    '## Not in scope',
    '',
    'Do not build these, even if they seem helpful.',
    '',
    ...bullets(c.non_goals, 'Nothing listed.'),
    '',
  );
  req.push('## Data', '');
  if (!c.data_contracts.length)
    req.push('The spec declares no data. Use only made-up (synthetic) data.');
  for (const d of c.data_contracts)
    req.push(
      `- **${inlineText(d.name)}** (${d.data_class === 'private_approved' ? 'approved private data: not in this bundle; the owner must supply it' : d.data_class === 'public' ? 'public data' : 'synthetic data'}): ${inlineText(d.description)}`,
    );
  req.push('', '## Acceptance checks', '');
  req.push(
    'Each check has a key (A1, A2, ...). A check passes only when it is run and observed to pass.',
    '',
  );
  for (const a of checks) {
    req.push(
      `### ${a.key} — ${inlineText(a.statement)}`,
      '',
      `- Method: ${METHOD_WORDS[a.method] ?? a.method}`,
      `- What is measured: ${inlineText(a.measure)}`,
      ...(a.flow ? [`- Flow: ${a.flow}`] : []),
    );
    if (a.held_out_cases_withheld)
      req.push(
        `- ${plural(a.held_out_cases_withheld, 'more case')} for this check ${a.held_out_cases_withheld === 1 ? 'is' : 'are'} held by the owner and not shown here.`,
      );
    req.push('');
    a.cases.forEach((x, i) => {
      req.push(
        `Case ${i + 1}: arguments ${code(JSON.stringify(x.args))}, expected exit code ${x.exit_code}.`,
        '',
        ...(x.stdin ? ['Standard input:', '', fenced(x.stdin), ''] : []),
        x.stdout
          ? 'Expected standard output (exact):'
          : 'Expected standard output: empty.',
        '',
        ...(x.stdout ? [fenced(x.stdout), ''] : []),
      );
    });
    a.browser_cases.forEach((x, i) => {
      req.push(
        `Browser case ${i + 1}: open ${code(x.page)}, then do these steps in order (selectors are CSS):`,
        '',
        fenced(
          x.steps
            .map(
              (st, n) =>
                `${n + 1}. ${oneLine(stepWords(st as Record<string, unknown>))}`,
            )
            .join('\n'),
        ),
        '',
      );
    });
    if (
      !a.cases.length &&
      !a.browser_cases.length &&
      !a.held_out_cases_withheld
    )
      req.push(
        a.method === 'manual_review' || a.method === 'metric'
          ? 'No executable case: a person judges this check against the statement and measure above.'
          : 'No executable case is recorded for this check, so it cannot be run as written. Treat it as a manual check and tell the owner.',
        '',
      );
  }
  req.push('## Risks', '');
  if (!c.risks.length) req.push('None recorded.');
  for (const r of c.risks)
    req.push(
      `- ${inlineText(r.risk)} — mitigation: ${inlineText(r.mitigation)}`,
    );
  req.push(
    '',
    '## Maintenance',
    '',
    `- Owner: ${inlineText(c.maintenance.owner)}`,
    `- Review interval: ${inlineText(c.maintenance.review_interval)}`,
    ...c.maintenance.obligations.map((o) => `- ${inlineText(o)}`),
    '',
  );

  // ---- TASKS.md
  const tk: string[] = [
    '# Task plan',
    '',
    'Tasks in the order to do them. A task may start only when every task it depends on has passed its gate.',
    '',
    '| Order | Task | Role | Depends on | Delivers checks | May change |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  tasks.forEach((t, i) =>
    tk.push(
      `| ${i + 1} | ${t.key} — ${inlineText(t.title)} | ${t.role} | ${t.depends_on.join(', ') || 'nothing'} | ${t.acceptance.join(', ') || 'none'} | ${t.file_scope.map((p) => `\`${p}\``).join(', ') || 'no files'} |`,
    ),
  );
  tk.push('', '## Dependencies', '');
  for (const t of tasks)
    tk.push(
      t.depends_on.length
        ? `- ${t.key} needs ${t.depends_on.join(', ')}`
        : `- ${t.key} needs nothing and can start after setup`,
    );
  tk.push('', '## Deliverables', '');
  for (const t of tasks) tk.push(`- ${t.key}: ${inlineText(t.deliverable)}`);
  tk.push('');

  // ---- STACK.md
  const st: string[] = ['# Stack and limits', ''];
  if (stack)
    st.push(
      `**Proposed stack: ${stack.name}.**`,
      '',
      'This is a proposal, not an owner decision. It is the stack the frozen acceptance cases were written for, so another stack must still pass the same cases in the same way.',
      '',
      ...stack.lines.map((l) => `- ${l}`),
      '',
      ...(recipe === 'python-build/1' && !hasCli
        ? [
            'No command-line case is visible in this bundle (the owner holds them back), so no check script is shipped. The lines above say how the owner will run the hidden cases.',
            '',
          ]
        : []),
      `Creator Agent calls this recipe \`${recipe}\`. That name only says the checks fit the recipe; it does not say any model or tool is qualified to build it.`,
      '',
    );
  else
    st.push(
      '**No stack is proposed.** The spec’s checks do not fit one supported recipe, so the stack is an open decision for the owner (see DECISIONS.md). Do not pick one silently: propose it, with reasons, and wait for the owner.',
      '',
    );
  st.push(
    '## Limits that always apply',
    '',
    '- Build only what REQUIREMENTS.md lists as in scope.',
    '- Use only the data classes REQUIREMENTS.md allows. Do not fetch, scrape or invent real personal data.',
    '- No credentials, accounts, payments, publication or deployment are part of this bundle. Each needs its own decision by the owner.',
    '- Keep every change inside the files the current task may change (TASKS.md).',
    '',
  );

  // ---- DECISIONS.md
  const open: string[] = [];
  if (!input.freeze)
    open.push(
      'Freeze the requirements, or confirm this draft version is the one to build.',
    );
  if (!stack) open.push('Choose the stack (see STACK.md).');
  if (!humility)
    open.push(
      'Carry out the should-this-be-software (humility) review of this spec version, or confirm the work should go ahead without one.',
    );
  else if (!humility.build_admissible)
    open.push(
      ethicsOnly
        ? 'Give the ethical judgement the should-this-be-software review asks for (see above) before any build.'
        : 'Decide whether the work should go ahead although the should-this-be-software review does not clear a build (see above).',
    );
  const judged = checks.filter(
    (a) =>
      !a.cases.length && !a.browser_cases.length && !a.held_out_cases_withheld,
  );
  if (judged.length)
    open.push(
      `Name who judges the checks that have no executable case here (${judged.map((a) => a.key).join(', ')}) and how.`,
    );
  if (heldOut)
    open.push(
      `Run the ${plural(heldOut, 'held-out case')} on the finished work; only the owner has ${heldOut === 1 ? 'it' : 'them'}.`,
    );
  if (c.data_contracts.some((d) => d.data_class === 'private_approved'))
    open.push(
      'Supply the approved private data the spec names, or confirm synthetic stand-ins are acceptable for development.',
    );
  if (!selection.current)
    open.push(
      'Confirm the work should still go ahead: the selection was replaced.',
    );
  open.push(
    'Where and how the result is released, hosted, published or sold. Nothing here decides that.',
    'The licence for the code, and who may see the repository.',
  );
  const dec: string[] = [
    '# Decisions and assumptions',
    '',
    'This file separates what people recorded as decided from what this bundle only proposes.',
    '',
    '## Decided and recorded',
    '',
    ...decisionLines(selection, option),
  ];
  dec.push(
    input.freeze
      ? `- **Requirements frozen** on ${input.freeze.frozen_at.slice(0, 10)} at spec version ${spec.version} (freeze ${input.freeze.id.slice(0, 8)}).`
      : '- The requirements are **not** frozen; nothing about them is decided yet.',
  );
  if (humility)
    dec.push(
      `- **Should-this-be-software review** (review ${humility.id.slice(0, 8)}, of spec version ${humility.subject_version}): disposition “${inlineText(humility.disposition.replaceAll('_', ' '))}”.`,
      `  - The software part: ${inlineText(humility.software_part)}`,
      `  - The part people keep: ${inlineText(humility.human_part)}`,
      `  - Rationale: ${inlineText(humility.rationale)}`,
      `  - Ethics: ${humility.ethical_status === 'unresolved_serious' ? '**a serious ethical problem is unresolved**' : humility.ethical_status === 'resolved' ? 'a problem was raised and recorded as resolved' : 'none identified'}${humility.ethical_note ? `. ${inlineText(humility.ethical_note)}` : ''}`,
      ...humility.dissent.map((d) => `  - Dissent: ${inlineText(d)}`),
      humility.build_admissible
        ? '  - The studio’s pre-build gate accepts this review for this spec version.'
        : ethicsOnly
          ? '  - **The studio’s pre-build gate needs the owner’s ethical judgement** before it accepts this review for a build.'
          : `  - **The studio’s pre-build gate does not accept this review for a build:** ${humility.gate_reasons.map((r) => inlineText(r)).join(' ') || 'not admissible.'}`,
    );
  else
    dec.push(
      '- **No should-this-be-software review** of this spec is recorded. Whether this should be software at all has not been reviewed.',
    );
  dec.push(
    '',
    '## Proposed by this bundle (not decided)',
    '',
    stack
      ? `- The stack in STACK.md (${stack.name}).`
      : '- No stack is proposed.',
    '- The order of tasks that do not depend on each other (TASKS.md keeps the spec’s order).',
    '- The split into one prompt per task, and the wording of the prompts.',
    '',
    '## Assumptions that would change the plan',
    '',
  );
  const assumptions = [
    ...(selection.reverse_if
      ? [`The selection would be reversed if: ${selection.reverse_if}`]
      : []),
    ...(humility
      ? [
          `Change course if: ${humility.change_course_trigger}`,
          `A test that could show this is the wrong response: ${humility.disconfirming_test}`,
        ]
      : []),
    ...(option.uncertainty
      ? [`Uncertainty recorded with the option: ${option.uncertainty}`]
      : []),
    ...option.tradeoffs.map((t) => `Trade-off recorded with the option: ${t}`),
    ...(humility?.burden_risks ?? []).map(
      (r) => `Burden or risk named in review: ${r}`,
    ),
  ];
  dec.push(...bullets(assumptions, 'None recorded.'));
  dec.push(
    '',
    '## Still to decide (by the owner)',
    '',
    ...open.map((o) => `- ${o}`),
    '',
  );

  // ---- CONTRACT.md
  const contract = [
    `# Project contract — ${inlineText(title)}`,
    '',
    'Paste this whole file at the start of every session, before the prompt for the step.',
    '',
    fenced(
      [
        `You are implementing one step of a project called "${title}".`,
        'You have a folder of files called the runbook bundle. It is your only source of',
        'requirements. You have no access to the system that produced it, and you do not need any.',
        '',
        'Where things are:',
        '  <bundle>   stands for the path of the bundle folder: the one that holds README.md,',
        '             manifest.json and this file. Replace it with the real path in every command.',
        '             Keep the bundle outside the project folder and never commit it.',
        '  Every file named in capitals below (REQUIREMENTS.md and so on) is in <bundle>.',
        '  The project is the separate folder that the setup step creates. Commands run from it.',
        '',
        'What the project is for:',
        problem
          ? `  Problem: ${oneLine(problem.statement || problem.title)}`
          : `  Problem: ${oneLine(c.problem_statement)}`,
        ...(problem?.affected_group
          ? [`  Who it affects: ${oneLine(problem.affected_group)}`]
          : []),
        `  Who the software is for: ${oneLine(c.audience)}`,
        `  Chosen response: ${oneLine(option.title)}`,
        '',
        'Read before you start a step:',
        '  REQUIREMENTS.md  what to build and the acceptance checks (fixed; do not edit)',
        '  TASKS.md         the tasks, their order and the files each may change',
        '  STACK.md         the proposed stack and the limits',
        '  DECISIONS.md     what is decided, what is only proposed, what is still open',
        '  EVIDENCE.md      why the problem is believed to be real',
        '  RECOVERY.md      what to do when something fails',
        '',
        'Rules for every step:',
        '  1. Do only the step in the prompt you were given. Do not start the next one.',
        '  2. Change only the files that step may change.',
        '  3. Never edit the bundle, a requirement, an acceptance check or an expected output.',
        '  4. Build nothing listed under "Not in scope".',
        '  5. Do not use credentials, accounts, payments, real personal data or the network',
        '     unless the step says the owner has provided it. The bundle grants no access.',
        '  6. If you need a decision that DECISIONS.md lists as open, stop and ask. Do not guess.',
        '     One exception: a check that a person must judge (manual review or metric). Who',
        '     judges it may still be open. Carry the check out as REQUIREMENTS.md describes,',
        '     record what you saw as provisional, and go on. Only the owner’s judge can pass it.',
        '  7. Report only what you ran and saw. Say "not run" for anything you did not run.',
        ...(heldOut
          ? [
              `  8. ${plural(heldOut, 'acceptance case')} ${heldOut === 1 ? 'is' : 'are'} held back by the owner. Passing the visible cases does`,
              '     not show the work is accepted. Make the behaviour right, not just the cases.',
            ]
          : []),
        `  ${heldOut ? 9 : 8}. Where a requirement can be read more than one way and no case settles it, take`,
        '     the reading that does less and refuses more (refuse unclear input rather than guess',
        '     what it means), and add one line to ASSUMPTIONS.md in the project: the',
        '     requirement, the reading you took, and the other reading. This is not a reason',
        '     to stop. It is for readings of a requirement only, never for an open decision.',
        `  ${heldOut ? 10 : 9}. Five files at the project root belong to no task: README.md, .gitignore,`,
        '     ASSUMPTIONS.md, REVIEW.md and HANDOVER.md. A step may change one of them only',
        '     where its prompt says so, except that any step may add a line to ASSUMPTIONS.md.',
        '     Such a change does not count as a change outside the task’s scope.',
        '',
        'End every step with a short report: what changed (files), what you ran and its',
        'result, whether the completion gate passed, and anything the owner must decide.',
      ].join('\n'),
    ),
    '',
  ].join('\n');

  // ---- Prompts
  const runner = hasCli ? 'python3 <bundle>/checks/run_checks.py' : null;
  const prompts: PromptDraft[] = [
    {
      step: 'setup',
      slug: 'setup',
      title: 'Set up the workspace',
      task: null,
      needs: [],
      scope: [
        'Create an empty project folder with version control and the folder layout the tasks need.',
        'Write no feature code.',
      ],
      artifacts: [
        'A new Git repository with one commit.',
        'A short `README.md` in the project that names the project and says how to run the checks.',
        ...(recipe === 'python-build/1'
          ? [
              'A `.gitignore` that lists `__pycache__/` and `*.pyc`, so running the checks leaves `git status` clean.',
            ]
          : []),
        stack
          ? `The empty entry point for the proposed stack (${recipe === 'static-web/1' ? '`site/index.html`' : '`src/main.py`'}).`
          : 'A note to the owner proposing a stack, and no entry point yet.',
      ],
      gate: [
        '`git status` is clean and `git log` shows one commit.',
        ...(runner
          ? [
              `\`${runner}\` starts and reports the cases (they are expected to fail now).`,
            ]
          : []),
        'Your report lists every open decision from DECISIONS.md that blocks a later step.',
      ],
      body: [
        'Step: set up the workspace. Write no feature code in this step.',
        '',
        '1. Read every file named in the project contract.',
        '2. Create a new, empty project folder outside the bundle and run `git init` in it.',
        stack
          ? `3. Create the layout for the proposed stack: ${stack.name}. ${recipe === 'static-web/1' ? 'Add site/index.html with only a title.' : 'Add src/main.py that exits with code 0 and prints nothing.'}`
          : '3. No stack is proposed. Read STACK.md and DECISIONS.md, propose one stack to the owner with reasons, and stop until the owner answers.',
        '4. Create every folder that TASKS.md lets a task change. Git does not keep an empty folder, so put an empty file named .gitkeep in each folder that has no other file. Leave it there when real files arrive later; removing it is no task’s job.',
        recipe === 'python-build/1'
          ? '5. Add a README.md that names the project and says how to run the checks, and a .gitignore with the two lines __pycache__/ and *.pyc.'
          : '5. Add a README.md that names the project and says how to run the checks.',
        ...(runner
          ? [
              `6. Run: ${runner}   (from the project folder). Failures are expected; the script must start. On Windows use python or py -3 in place of python3 (see STACK.md).`,
            ]
          : []),
        `${runner ? 7 : 6}. Commit. Then report, including each open decision in DECISIONS.md that would block a later step.`,
      ],
    },
  ];
  const promptIndex = new Map<string, number>();
  for (const t of tasks) {
    const mine = t.acceptance
      .map((k) => checkOf.get(k))
      .filter((a): a is (typeof checks)[number] => !!a);
    const cli = mine.some((a) => a.cases.length > 0);
    // A check a person must judge cannot "pass" inside a step: its judge may be an open decision.
    const person_judged = (a: (typeof mine)[number]) =>
      a.method === 'manual_review' || a.method === 'metric';
    // Every case of the check is held back: nothing to run here and nobody to judge it. The
    // owner runs the hidden cases.
    const hidden = mine.filter(
      (a) =>
        !person_judged(a) &&
        !a.cases.length &&
        !a.browser_cases.length &&
        a.held_out_cases_withheld > 0,
    );
    const judged = mine.filter(
      (a) =>
        !hidden.includes(a) &&
        (person_judged(a) || (!a.cases.length && !a.browser_cases.length)),
    );
    const runnable = mine.filter(
      (a) => !judged.includes(a) && !hidden.includes(a),
    );
    const keys = (list: typeof mine) => list.map((a) => a.key).join(', ');
    // A review is written into a folder the task may change, or a Markdown file it names;
    // never into a code file that happens to be first in its scope.
    const scopes = t.file_scope.map((p) => p.replace(/\/+$/, ''));
    const reviewDoc = scopes.find((p) => /\.(?:md|markdown|txt)$/i.test(p));
    const reviewDir = scopes.find((p) => !/\.[a-z0-9]+$/i.test(p));
    const reviewFile =
      reviewDoc ??
      (reviewDir
        ? `${reviewDir}/${t.key.toLowerCase()}-review.md`
        : 'your report (this task may change no file that can hold a review)');
    const person = t.role === 'owner';
    const needs = [0, ...t.depends_on.map((d) => promptIndex.get(d)!)];
    const scopePaths = t.file_scope.length
      ? t.file_scope.map((p) => `\`${p}\``).join(', ')
      : 'no files';
    promptIndex.set(t.key, prompts.length);
    prompts.push({
      step: 'slice',
      slug: `${t.key.toLowerCase()}-${slug(t.title, 'task')}`,
      title: `${t.key}: ${oneLine(t.title)}`,
      task: t.key,
      needs,
      scope: [
        `Task ${t.key} only, in the role of ${ROLE_WORDS[t.role] ?? t.role}.`,
        `May change: ${scopePaths} (a folder covers everything under it).`,
        ...(person
          ? [
              'This task belongs to the project owner. A coding model may prepare material for it but cannot complete it.',
            ]
          : []),
      ],
      artifacts: [
        inlineText(t.deliverable),
        'One commit that contains only this task’s changes.',
      ],
      gate: [
        ...(runnable.length
          ? [
              runnable.length === 1
                ? `Check ${runnable[0]!.key} passes when run now.`
                : `Checks ${keys(runnable)} pass when run now.`,
            ]
          : []),
        ...(judged.length
          ? [
              `${judged.length === 1 ? `Check ${judged[0]!.key} is` : `Checks ${keys(judged)} are`} carried out as REQUIREMENTS.md describes and what was seen is recorded as provisional. This step does not decide that ${judged.length === 1 ? 'it passes' : 'they pass'}: the owner’s judge does, even if DECISIONS.md has not named one yet.`,
            ]
          : []),
        ...(hidden.length
          ? [
              `${hidden.length === 1 ? `Check ${hidden[0]!.key} has` : `Checks ${keys(hidden)} have`} no case in this bundle: the owner holds ${hidden.length === 1 ? 'its cases' : 'their cases'} back. The behaviour ${hidden.length === 1 ? 'its statement describes' : 'their statements describe'} is implemented; this step cannot show that ${hidden.length === 1 ? 'it passes' : 'they pass'}, and the owner runs the held-out cases.`,
            ]
          : []),
        ...(mine.length
          ? []
          : ['The deliverable exists and matches its description.']),
        ...(cli ? [`\`${runner} --task ${t.key}\` ends with 0 failed.`] : []),
        ...(needs.length > 1 || promptIndex.size > 1
          ? ['Every check that passed before this task still passes.']
          : []),
        'No file outside the task’s scope changed (`git diff --stat` against the previous commit). A line added to `ASSUMPTIONS.md` under the contract’s rules is allowed.',
      ],
      body: [
        `Step: task ${t.key} — ${oneLine(t.title)}`,
        `Role: ${ROLE_WORDS[t.role] ?? t.role}`,
        `Deliverable: ${oneLine(t.deliverable)}`,
        `Files you may change: ${t.file_scope.join(', ') || 'none'}`,
        `Depends on: ${t.depends_on.join(', ') || 'setup only'}`,
        `Acceptance checks to satisfy: ${t.acceptance.join(', ') || 'none assigned'}`,
        '',
        ...(person
          ? [
              'This task is for the project owner. Do not claim it is done. Prepare what',
              'the owner needs to do it, list it clearly, and stop.',
              '',
            ]
          : []),
        '1. Read the checks named above in REQUIREMENTS.md, with every case shown for them.',
        '2. Check that the tasks this one depends on are committed and their checks pass.',
        t.role === 'reviewer'
          ? `3. Review the work those tasks produced against the checks named above only (the review of the whole project is a later step). Change no code. Write the review to ${reviewFile}: findings with file and line, most serious first, and one line saying whether this session wrote any of the code it reviewed.`
          : t.role === 'qa'
            ? '3. Run the checks exactly as written and record each result. Do not fix code in this task; report failures.'
            : '3. Make the smallest change that satisfies the checks, inside the allowed files only.',
        ...(cli
          ? [`4. Run: ${runner} --task ${t.key}   and read every FAIL line.`]
          : [
              [
                '4.',
                ...(mine.length > hidden.length || !mine.length
                  ? [
                      'Carry out each check as REQUIREMENTS.md describes and record what you saw.',
                    ]
                  : []),
                ...(judged.length
                  ? [
                      'For a check a person must judge, record your result as provisional and do not stop because its judge is not named.',
                    ]
                  : []),
                ...(hidden.length
                  ? [
                      `No case is shown for ${keys(hidden)}: implement what the statement says and report that only the owner can run ${hidden.length === 1 ? 'its' : 'their'} cases.`,
                    ]
                  : []),
              ].join(' '),
            ]),
        '5. Run the checks of the earlier tasks again. Nothing that passed may now fail.',
        '6. Commit only this task’s changes, then report against the completion gate.',
        '',
        'If a check cannot pass without changing a file outside your scope, or without',
        'changing the check, stop and report. Follow RECOVERY.md.',
      ],
    });
  }
  const slices = tasks.map((t) => promptIndex.get(t.key)!);
  const reviewAt = prompts.length;
  prompts.push({
    step: 'review_repair',
    slug: 'review-and-repair',
    title: 'Independent review and repair',
    task: null,
    needs: [0, ...slices],
    scope: [
      'Review the whole project against REQUIREMENTS.md in a fresh session that did not write the code.',
      'Then repair only what the review found, each fix inside the scope of the task that owns the file.',
      'May also change `README.md` and `REVIEW.md` at the project root, which no task owns.',
    ],
    artifacts: [
      'A `REVIEW.md` in the project: findings by severity with file and line, and for each the fix or the reason it stays.',
      'One commit per repaired finding.',
    ],
    gate: [
      ...(runner ? [`\`${runner}\` ends with 0 failed.`] : []),
      'Every finding in `REVIEW.md` is marked fixed, or left with a stated reason for the owner.',
      'Nothing listed under “Not in scope” was built.',
    ],
    body: [
      'Step: independent review, then repair. Use a session that did not write the code.',
      '',
      'Part 1, review (change nothing):',
      '1. Read REQUIREMENTS.md, then the code and its history.',
      '2. For each acceptance check, decide whether the code truly does what the statement',
      '   says, not only what the visible cases test. Other cases exist that you cannot see.',
      '3. Look for: behaviour outside the scope, a non-goal that was built, a changed check,',
      '   input that crashes it, data the spec does not allow, anything a risk in',
      '   REQUIREMENTS.md warned about.',
      '   Also check that each mitigation REQUIREMENTS.md gives for a risk is in place. One',
      '   that belongs in the documentation (for example a rule the README must state) is',
      '   a finding if it is missing.',
      '   Read ASSUMPTIONS.md if it exists: a reading there that looks wrong is a finding.',
      '4. Write REVIEW.md: findings, most serious first, each with file and line.',
      '',
      'Part 2, repair:',
      '5. Fix each finding inside the scope of the task that owns the file. One commit each.',
      '   A finding about README.md is fixed in README.md in this step; no task owns it.',
      ...(runner
        ? [`6. After each fix run: ${runner}`]
        : ['6. After each fix, repeat every check.']),
      '7. Mark each finding fixed, or say why it stays and what the owner must decide.',
      '',
      'Do not review your own work and call it independent. If this session wrote the',
      'code, say so in REVIEW.md.',
    ],
  });
  prompts.push({
    step: 'verify_export',
    slug: 'verify-and-hand-over',
    title: 'Verify and hand over',
    task: null,
    needs: [reviewAt],
    scope: [
      'Verify the finished project from a clean copy and package it for the owner.',
      'Change no feature code. Publish, deploy and release nothing.',
    ],
    artifacts: [
      'A `HANDOVER.md` in the project: how to run it, each check with its observed result, what was not run, known limits and open decisions.',
      'A source archive made from the final commit (for example `git archive`), written outside the project folder, beside it.',
    ],
    gate: [
      'From a fresh clone, the checks give the results `HANDOVER.md` records.',
      '`HANDOVER.md` marks every check that was not executed as “not run”.',
      ...(heldOut
        ? [
            `\`HANDOVER.md\` says the ${plural(heldOut, 'held-out case')} ${heldOut === 1 ? 'was' : 'were'} not run and the owner must run ${heldOut === 1 ? 'it' : 'them'}.`,
          ]
        : []),
    ],
    body: [
      'Step: verify and hand over. Change no feature code.',
      '',
      '1. Clone the project into a new, empty folder so nothing untracked can help it pass.',
      ...(runner
        ? [`2. In the clone run: ${runner}   and keep the full output.`]
        : [
            '2. In the clone, carry out every acceptance check and keep what you saw.',
          ]),
      '3. Carry out each check the script does not run (browser, manual, metric) as',
      '   REQUIREMENTS.md describes, or mark it "not run" and say who must do it.',
      '4. Write HANDOVER.md: how to run the project, each check key with its observed',
      '   result, what was not run, known limits, and the decisions DECISIONS.md leaves open.',
      '   Copy in every line of ASSUMPTIONS.md, if it exists, for the owner to confirm.',
      '   Commit HANDOVER.md; this step may change no other file.',
      '5. Make a source archive from the final commit. Write it outside the project folder',
      '   (beside it), so the project stays clean, and give its path in the report.',
      '6. Report. Do not publish, deploy, release, or say the owner has accepted the work.',
      ...(heldOut
        ? [
            '',
            `The owner still has ${plural(heldOut, 'held-out case')}. The work is not accepted until the owner runs ${heldOut === 1 ? 'it' : 'them'}.`,
          ]
        : []),
    ],
  });
  const { files: promptDrafts, listed } = promptFiles(prompts, 'CONTRACT.md');

  // ---- README.md
  const readme = [
    `# ${inlineText(title)} — implementation runbook`,
    '',
    'This folder is a self-contained handover for a coding model or a developer who has never seen the system that produced it. Everything needed to build the project is in these files; nothing here links back to that system.',
    '',
    '_This is a plan to implement. Nothing in it shows the software exists, works, or has been accepted._',
    '',
    '## What this is for',
    '',
    problem
      ? `**Problem:** ${inlineText(problem.statement || problem.title)}`
      : `**Problem:** ${inlineText(c.problem_statement)}`,
    '',
    ...(problem?.affected_group
      ? [`**Who it affects:** ${inlineText(problem.affected_group)}`, '']
      : []),
    `**Chosen response:** ${inlineText(option.title)} (${kindWords(option.kind)})`,
    '',
    ...(option.rationale
      ? [`**Why this option:** ${inlineText(option.rationale)}`, '']
      : []),
    ...(warnings.length
      ? ['## Read this first', '', ...warnings.map((w) => `- ${w}`), '']
      : []),
    '## How to use it',
    '',
    '1. Read [DECISIONS.md](DECISIONS.md). Settle anything under “Still to decide” that blocks you.',
    '2. For each prompt below, in order: open a fresh session, paste [CONTRACT.md](CONTRACT.md), then paste the prompt.',
    '3. Do not start a prompt until the ones it depends on have passed their completion gate.',
    '4. When a gate fails, follow [RECOVERY.md](RECOVERY.md).',
    '',
    '## Prompts, in order',
    '',
    '| # | Prompt | Needs |',
    '| --- | --- | --- |',
    ...listed.map(
      (p) =>
        `| ${two(p.order)} | [${inlineText(p.title)}](${p.path}) | ${p.prerequisites.map((x) => x.slice(8, 10)).join(', ') || 'nothing'} |`,
    ),
    '',
    '## Files',
    '',
    '- [CONTRACT.md](CONTRACT.md): the shared project contract, pasted before every prompt.',
    '- [REQUIREMENTS.md](REQUIREMENTS.md): audience, flows, scope, data, acceptance checks, risks.',
    '- [TASKS.md](TASKS.md): the tasks, their order and dependencies.',
    '- [STACK.md](STACK.md): the proposed stack and the limits.',
    '- [DECISIONS.md](DECISIONS.md): decided, proposed, assumed and still open.',
    '- [EVIDENCE.md](EVIDENCE.md): the claims and sources behind the problem.',
    '- [RECOVERY.md](RECOVERY.md): what to do when something fails.',
    '- [spec.json](spec.json): the requirements as data.',
    '- [checks/acceptance.json](checks/acceptance.json): the acceptance checks and visible cases as data.',
    ...(hasCli
      ? [
          '- [checks/run_checks.py](checks/run_checks.py): runs the command-line cases (Python 3, no packages).',
        ]
      : []),
    HASH_NOTE,
    '',
    '## Validation commands',
    '',
    ...(hasCli
      ? [
          'From the project folder (the one that holds `src/`):',
          '',
          fenced(
            [
              'python3 <bundle>/checks/run_checks.py              # every visible command-line case',
              'python3 <bundle>/checks/run_checks.py --task T1    # one task’s cases',
              'python3 <bundle>/checks/run_checks.py --check A1   # one check',
            ].join('\n'),
            'sh',
          ),
          '',
          'It prints PASS or FAIL per case and exits 0 only when every case it ran passed. Use `--cmd` to test a program that starts another way.',
          '',
        ]
      : [
          ((hidden) =>
            hidden.length === checks.length
              ? 'Every case is held back by the owner, so there is nothing to run here: implement what each check in [REQUIREMENTS.md](REQUIREMENTS.md) states, and the owner runs the held-out cases.'
              : hidden.length
                ? `This bundle has no command-line cases, so there is no script to run. Carry out each check as [REQUIREMENTS.md](REQUIREMENTS.md) describes, except ${hidden.map((a) => a.key).join(', ')}: every case of ${hidden.length === 1 ? 'that check' : 'those checks'} is held back, so implement what ${hidden.length === 1 ? 'it states' : 'they state'} and the owner runs the held-out cases.`
                : 'This bundle has no command-line cases, so there is no script to run. Carry out each check as [REQUIREMENTS.md](REQUIREMENTS.md) describes.')(
            checks.filter(
              (a) =>
                !a.cases.length &&
                !a.browser_cases.length &&
                a.held_out_cases_withheld > 0,
            ),
          ),
          '',
        ]),
    ...(checks.some((a) => !a.cases.length)
      ? [
          'Checks without command-line cases (browser, manual, metric) are listed by the script as not run; a person or a browser tool carries them out.',
          '',
        ]
      : []),
    '## What is deliberately not here',
    '',
    `- Held-out acceptance cases: ${heldOut ? `${heldOut}, kept by the owner to test the result` : 'none exist for this spec'}.`,
    '- Credentials, accounts and access of any kind.',
    '- Personal folder paths and anything shaped like a credential (removed if found).',
    '- Private notes, scores, chat and other records that the spec does not cite.',
    '',
    '## Where it came from',
    '',
    `- Spec ${spec.id}, version ${spec.version}, ${frozenWords}`,
    `- Spec content hash \`${spec.content_hash}\`, version saved ${spec.saved_at}`,
    `- Selection ${selection.id}${selection.current ? '' : ' (replaced by a later one)'}`,
    `- Option ${option.id}, version ${option.version}`,
    ...(problem ? [`- Problem ${problem.id}, version ${problem.version}`] : []),
    '- Produced by Creator Agent’s runbook export (`runbook/1`) from recorded data; no model wrote these files.',
    '',
  ].join('\n');

  const specJson = {
    format: 'runbook-spec/1',
    title,
    spec: {
      id: spec.id,
      version: spec.version,
      content_hash: spec.content_hash,
    },
    frozen: !!input.freeze,
    audience: c.audience,
    problem_statement: c.problem_statement,
    user_flows: c.user_flows,
    scope: c.scope,
    non_goals: c.non_goals,
    data_contracts: c.data_contracts,
    acceptance_checks: checks,
    risks: c.risks,
    maintenance: c.maintenance,
    tasks,
    held_out_cases_withheld: heldOut,
  };
  const acceptance = {
    format: 'runbook-checks/1',
    held_out_cases_withheld: heldOut,
    tasks: tasks.map((t) => ({
      key: t.key,
      title: t.title,
      acceptance: t.acceptance,
    })),
    checks: checks.map((a) => ({
      key: a.key,
      method: a.method,
      statement: a.statement,
      measure: a.measure,
      cases: a.cases,
      browser_cases: a.browser_cases,
      not_run_reason: a.cases.length
        ? null
        : a.browser_cases.length
          ? 'browser case; carry it out in a browser'
          : a.held_out_cases_withheld
            ? 'every case is held by the owner'
            : 'no executable case; a person judges it',
    })),
  };
  const drafts: Draft[] = [
    { path: 'README.md', text: readme },
    { path: 'CONTRACT.md', text: contract },
    { path: 'REQUIREMENTS.md', text: req.join('\n') },
    { path: 'TASKS.md', text: tk.join('\n') },
    { path: 'STACK.md', text: st.join('\n') },
    { path: 'DECISIONS.md', text: dec.join('\n') },
    {
      path: 'EVIDENCE.md',
      text: evidenceFile(input.references, input.references_omitted),
    },
    { path: 'RECOVERY.md', text: RECOVERY('software') },
    { path: 'spec.json', text: JSON.stringify(specJson, null, 2) },
    {
      path: 'checks/acceptance.json',
      text: JSON.stringify(acceptance, null, 2),
    },
    ...(hasCli ? [{ path: 'checks/run_checks.py', text: RUN_CHECKS }] : []),
    ...promptDrafts,
  ];
  return finish(drafts, {
    kind: 'software',
    title: title.slice(0, 500),
    subject: {
      type: 'specification',
      id: spec.id,
      version: spec.version,
      content_hash: spec.content_hash,
      saved_at: spec.saved_at,
    },
    freeze: input.freeze,
    problem: problem ? { id: problem.id, version: problem.version } : null,
    option: { id: option.id, version: option.version },
    selection: { id: selection.id, current: selection.current },
    recipe,
    prompts: listed,
    withheld: {
      held_out_cases: heldOut,
      redacted_secrets: count.secrets,
      redacted_paths: count.paths,
    },
    warnings: warnings.map((w) => w.slice(0, 500)),
  });
}

// ---- Action runbook (from a non-code proposal) -------------------------------------------

/** A self-contained runbook for carrying out a non-code plan. People do the work. */
export function actionRunbook(raw: ActionRunbookInput): {
  files: RunbookFile[];
  manifest: RunbookManifest;
} {
  const count: Redactions = { secrets: 0, paths: 0 };
  const input = redactDeep(raw, count);
  const { proposal, option, selection, problem } = input;
  const body = proposal.body;
  const title = oneLine(proposal.title);
  const unknown = PROPOSAL_SECTIONS.filter(
    (k) => body.sections[k].state === 'unknown',
  );
  const label = (k: (typeof PROPOSAL_SECTIONS)[number]) =>
    PROPOSAL_SECTION_LABELS[k];
  const warnings: string[] = [];
  if (unknown.length)
    warnings.push(
      `${plural(unknown.length, 'section')} of the plan ${unknown.length === 1 ? 'is' : 'are'} still unknown: ${unknown.map(label).join('; ')}.`,
    );
  // PLAN.md is rendered here, from the text that was just redacted: a copy rendered earlier
  // would carry escaped record text the patterns can no longer see.
  const references = proposal.checks.references;
  const plan = proposalMarkdown({
    id: proposal.id,
    version: proposal.version,
    title: proposal.title,
    content_hash: proposal.content_hash,
    body,
    checks: proposal.checks,
    problem_title: proposal.problem_title,
    option_title: proposal.option_title,
    saved_at: proposal.saved_at,
  });
  if (proposal.checks.blockers)
    warnings.push(
      `The plan has ${plural(proposal.checks.blockers, 'open blocker')} (listed at the end of PLAN.md).`,
    );
  if (!selection.current)
    warnings.push(
      'A later selection for the problem replaced the one this plan follows.',
    );
  if (option.current_version !== option.version)
    warnings.push(
      option.current_version === null
        ? 'The option this plan describes is no longer active.'
        : `The option changed after this plan was written (version ${option.version}, now ${option.current_version}).`,
    );
  if (count.secrets || count.paths)
    warnings.push(
      `${plural(count.secrets, 'credential-like value')} and ${plural(count.paths, 'personal folder path')} were removed.`,
    );
  const sec = (k: (typeof PROPOSAL_SECTIONS)[number]) => {
    const s = body.sections[k];
    return s.state === 'written'
      ? s.text
      : s.state === 'unknown'
        ? `UNKNOWN. ${s.text}`.trim()
        : `Not applicable. ${s.text}`.trim();
  };

  const contract = [
    `# Plan contract — ${inlineText(title)}`,
    '',
    'Paste this whole file at the start of every session, before the prompt for the step. It also works as a briefing for a person.',
    '',
    fenced(
      [
        `You are helping people carry out a plan called "${title}".`,
        'This is not a software project. Nothing here asks you to write a program, and',
        'you must not turn the plan into one. People do the work; you help them prepare,',
        'keep track, and check.',
        'The files named below are in the runbook bundle: the folder that holds README.md,',
        'manifest.json and this file. It is your only source for the plan.',
        '',
        `Problem: ${oneLine(problem?.statement || problem?.title || body.summary)}`,
        ...(problem?.affected_group
          ? [`Who it affects: ${oneLine(problem.affected_group)}`]
          : []),
        `Chosen response: ${oneLine(option.title)} (${kindWords(body.response)})`,
        '',
        'Read before you start a step:',
        '  PLAN.md       the plan, section by section, exactly as written',
        '  DECISIONS.md  what is decided, what is assumed, what is still open',
        '  EVIDENCE.md   the claims and sources behind the plan',
        '  RECOVERY.md   what to do when a step fails',
        '',
        'Rules for every step:',
        '  1. Do only the step in the prompt you were given.',
        '  2. Never say a step was carried out unless a person tells you it was, and say who.',
        '  3. A section marked UNKNOWN is not known. Do not fill it with a guess; ask.',
        '  4. Do not contact anyone, spend money, sign up for anything or share personal',
        '     details. Draft, and let a person act.',
        '  5. Do not change the plan. Suggest changes to the owner instead.',
        '  6. This plan has not been tried. Nothing here shows it works.',
        '',
        'End every step with a short report: what was prepared, what people did (and who',
        'told you), what is still unknown, and what the owner must decide.',
      ].join('\n'),
    ),
    '',
  ].join('\n');

  const prompts: PromptDraft[] = [
    {
      step: 'action',
      slug: 'orient',
      title: 'Understand the plan and list what is missing',
      task: null,
      needs: [],
      scope: ['Read the bundle. Change and do nothing.'],
      artifacts: [
        'A one-page summary of the plan in plain words.',
        'A list of every unknown section and open decision, with who could settle each.',
      ],
      gate: [
        'The owner confirms the summary matches what they mean.',
        'Every unknown section in PLAN.md appears in the list.',
      ],
      body: [
        'Step: understand the plan. Do not act on it yet.',
        '',
        '1. Read PLAN.md, DECISIONS.md and EVIDENCE.md.',
        '2. Write a one-page summary: the problem, who it affects, what will be done, by',
        '   whom, and how anyone will know it helped.',
        '3. List every section marked UNKNOWN and every open decision. For each, say who',
        '   could settle it and what you would need from them.',
        '4. List the contrary evidence and what it would mean if it is right.',
        '5. Report. Wait for the owner to confirm the summary.',
      ],
    },
  ];
  if (unknown.length)
    prompts.push({
      step: 'action',
      slug: 'close-the-unknowns',
      title: 'Close the unknown sections with the owner',
      task: null,
      needs: [0],
      scope: [
        `Only these sections: ${unknown.map(label).join('; ')}.`,
        'Draft questions and options. The owner supplies the answers.',
      ],
      artifacts: [
        'For each unknown section: the question, the options, and the owner’s answer in their own words (or “still unknown”).',
      ],
      gate: [
        'Each unknown section has an owner answer, or is explicitly left unknown with the reason.',
        'No answer was written by the assistant on the owner’s behalf.',
      ],
      body: [
        'Step: close the unknown sections. You ask; the owner answers.',
        '',
        'Unknown now:',
        ...unknown.map(
          (k) =>
            `  - ${label(k)}: ${oneLine(body.sections[k].text) || 'no note'}`,
        ),
        '',
        '1. For each one, write the plainest question that would settle it and two or',
        '   three realistic options with what each would cost or risk.',
        '2. Ask the owner. Record the answer in their words.',
        '3. If the owner does not know, record "still unknown" and what would find out.',
        '4. Do not invent an answer, a cost, a date or a name.',
        '5. Report the answers and what remains unknown.',
      ],
    });
  const prepAt = prompts.length;
  prompts.push({
    step: 'action',
    slug: 'prepare',
    title: 'Prepare materials, roles and schedule',
    task: null,
    needs: prompts.map((_, i) => i),
    scope: [
      'Turn the Methods, Materials, Roles and Timeline sections into a checklist people can follow.',
      'Prepare drafts only. Send nothing and buy nothing.',
    ],
    artifacts: [
      'A step-by-step checklist with an owner for each step (roles, not private details).',
      'A list of materials with what is in hand and what is missing.',
      'A schedule with the stages from the Timeline section.',
    ],
    gate: [
      'Every step in the Methods section appears in the checklist, in order.',
      'The owner approves the checklist and schedule.',
    ],
    body: [
      'Step: prepare. Draft only; a person sends, buys and books.',
      '',
      `Methods: ${oneLine(sec('methods')).slice(0, 1500)}`,
      `Materials: ${oneLine(sec('materials')).slice(0, 800)}`,
      `Roles: ${oneLine(sec('roles')).slice(0, 800)}`,
      `Timeline: ${oneLine(sec('timeline')).slice(0, 800)}`,
      `Costs: ${oneLine(sec('costs')).slice(0, 800)}`,
      '',
      '(These are one-line copies. PLAN.md has the full text and is the authority.)',
      '',
      '1. Write the procedure as a numbered checklist. Each step: who does it (a role),',
      '   what they need, how they know it is done.',
      '2. List the materials: in hand, missing, and who gets each missing one.',
      '3. Lay the steps on the timeline. Mark any date that is a guess.',
      '4. A cost nobody knows stays "unknown". Do not write zero.',
      '5. Ask the owner to approve the checklist and schedule.',
    ],
  });
  const runAt = prompts.length;
  prompts.push({
    step: 'action',
    slug: 'carry-out-and-record',
    title: 'Carry out the steps and keep the record',
    task: null,
    needs: [prepAt],
    scope: [
      'People carry out the approved checklist. The assistant keeps the record and flags departures.',
    ],
    artifacts: [
      'A log: each step, who did it, when, and what was observed.',
      'A list of departures from the plan and why.',
    ],
    gate: [
      'Each checklist step is logged as done (by whom), skipped (why) or blocked (on what).',
      'Nothing is logged as done on the assistant’s own say-so.',
    ],
    body: [
      'Step: carry out and record. People act; you keep the log.',
      '',
      '1. For each checklist step, ask the person responsible what happened.',
      '2. Log it: step, role, date, what was observed. Use their words.',
      '3. If a step was changed or skipped, log why. Do not hide it.',
      '4. If anything in the Ethics and risks section starts to happen, say so at once',
      '   and follow RECOVERY.md.',
      '5. Report the log and any blocked step.',
      '',
      `Ethics and risks (one-line copy): ${oneLine(sec('ethics_risks')).slice(0, 1200)}`,
    ],
  });
  prompts.push({
    step: 'action',
    slug: 'evaluate-and-review',
    title: 'Evaluate against the plan’s own criteria',
    task: null,
    needs: [runAt],
    scope: [
      'Compare what happened with the Objectives and the Testing and evaluation criteria.',
      'Say what the evidence shows and what it does not.',
    ],
    artifacts: [
      'An evaluation note: each criterion, what was observed, and whether it was met, not met or cannot be told.',
      'A recommendation to the owner: continue, change, or stop.',
    ],
    gate: [
      'Every criterion in the plan has one of: met, not met, cannot tell (with the reason).',
      'The note states the result that would count as failure, and whether it happened.',
      'Someone who did not carry out the steps has read the note.',
    ],
    body: [
      'Step: evaluate. Judge against the plan’s criteria, not new ones.',
      '',
      `Objectives: ${oneLine(sec('objectives')).slice(0, 1200)}`,
      `Evaluation criteria: ${oneLine(sec('evaluation')).slice(0, 1500)}`,
      ...(selection.reverse_if
        ? [
            `The decision would be reversed if: ${oneLine(selection.reverse_if)}`,
          ]
        : []),
      '',
      '1. For each criterion write what was observed and who observed it.',
      '2. Mark it met, not met, or cannot tell. "Cannot tell" is an honest answer.',
      '3. Do not change a criterion after seeing the result. If one was badly chosen,',
      '   say so separately.',
      '4. A few people trying something once is not proof. Say how many, and how long.',
      '5. Check the assumptions in DECISIONS.md: did any turn out wrong?',
      '6. Recommend continue, change or stop, and ask a person who did not do the work',
      '   to read the note.',
    ],
  });
  const { files: promptDrafts, listed } = promptFiles(prompts, 'CONTRACT.md');

  const assumptions = [
    ...(selection.reverse_if
      ? [`The selection would be reversed if: ${selection.reverse_if}`]
      : []),
    ...(option.uncertainty
      ? [`Uncertainty recorded with the option: ${option.uncertainty}`]
      : []),
    ...option.tradeoffs.map((t) => `Trade-off recorded with the option: ${t}`),
  ];
  const dec = [
    '# Decisions and assumptions',
    '',
    '## Decided and recorded',
    '',
    ...decisionLines(selection, option),
    '',
    '## Written in the plan (a proposal, not a decision)',
    '',
    'Everything in PLAN.md is what its authors propose. Reviews of the plan stay in the studio and are not part of this bundle, so this bundle does not show the plan was approved.',
    '',
    '## Assumptions that would change the plan',
    '',
    ...bullets(
      assumptions,
      'None recorded outside the plan’s own Assumptions section.',
    ),
    '',
    'See also the “Decision-changing assumptions” section of [PLAN.md](PLAN.md).',
    '',
    '## Still to decide (by the owner)',
    '',
    ...(unknown.length
      ? unknown.map((k) => `- ${label(k)} is unknown.`)
      : ['- No section is marked unknown.']),
    ...(selection.current
      ? []
      : ['- Whether to go ahead at all: the selection was replaced.']),
    '- Who is accountable for carrying the plan out, and when it starts.',
    '- Any spending, outside contact or use of personal data: each needs the owner’s own decision.',
    '',
  ].join('\n');

  const readme = [
    `# ${inlineText(title)} — action runbook`,
    '',
    'This folder is a self-contained handover for carrying out a plan that is **not** a software build. People do the work. An assistant can help prepare, keep the record and check, using the prompts below.',
    '',
    '_This is a plan. It has not been carried out, and nothing here shows that it works in practice._',
    '',
    `> ${inlineText(body.summary)}`,
    '',
    ...(warnings.length
      ? ['## Read this first', '', ...warnings.map((w) => `- ${w}`), '']
      : []),
    '## How to use it',
    '',
    '1. Read [PLAN.md](PLAN.md) and [DECISIONS.md](DECISIONS.md).',
    '2. For each prompt below, in order: paste [CONTRACT.md](CONTRACT.md), then the prompt. A person can also follow the prompts directly.',
    '3. Do not start a prompt until the ones it depends on have passed their completion gate.',
    '4. When a step fails, follow [RECOVERY.md](RECOVERY.md).',
    '',
    '## Prompts, in order',
    '',
    '| # | Prompt | Needs |',
    '| --- | --- | --- |',
    ...listed.map(
      (p) =>
        `| ${two(p.order)} | [${inlineText(p.title)}](${p.path}) | ${p.prerequisites.map((x) => x.slice(8, 10)).join(', ') || 'nothing'} |`,
    ),
    '',
    '## Files',
    '',
    '- [CONTRACT.md](CONTRACT.md): the shared contract, pasted before every prompt.',
    '- [PLAN.md](PLAN.md): the plan, exactly as saved.',
    '- [DECISIONS.md](DECISIONS.md): decided, assumed and still open.',
    '- [EVIDENCE.md](EVIDENCE.md): the claims and sources the plan cites.',
    '- [RECOVERY.md](RECOVERY.md): what to do when a step fails.',
    HASH_NOTE,
    '',
    '## How to check the work',
    '',
    'There is nothing to run. Each prompt ends with a completion gate that a person confirms. The last prompt compares what happened with the plan’s own evaluation criteria.',
    '',
    '## What is deliberately not here',
    '',
    '- Reviews of the plan, scores, chat and other studio records the plan does not cite.',
    '- Credentials, accounts and access of any kind.',
    '- Personal folder paths and anything shaped like a credential (removed if found).',
    '',
    '## Where it came from',
    '',
    `- Proposal ${proposal.id}, version ${proposal.version}, content hash \`${proposal.content_hash}\`, saved ${proposal.saved_at}`,
    `- Selection ${selection.id}${selection.current ? '' : ' (replaced by a later one)'}`,
    `- Option ${option.id}, version ${option.version}`,
    ...(problem ? [`- Problem ${problem.id}, version ${problem.version}`] : []),
    '- Produced by Creator Agent’s runbook export (`runbook/1`) from recorded data; no model wrote these files.',
    '',
  ].join('\n');

  return finish(
    [
      { path: 'README.md', text: readme },
      { path: 'CONTRACT.md', text: contract },
      { path: 'PLAN.md', text: plan },
      { path: 'DECISIONS.md', text: dec },
      { path: 'EVIDENCE.md', text: evidenceFile(references, 0) },
      { path: 'RECOVERY.md', text: RECOVERY('action') },
      ...promptDrafts,
    ],
    {
      kind: 'action',
      title: title.slice(0, 500),
      subject: {
        type: 'proposal',
        id: proposal.id,
        version: proposal.version,
        content_hash: proposal.content_hash,
        saved_at: proposal.saved_at,
      },
      freeze: null,
      problem: problem ? { id: problem.id, version: problem.version } : null,
      option: { id: option.id, version: option.version },
      selection: { id: selection.id, current: selection.current },
      recipe: 'none',
      prompts: listed,
      withheld: {
        held_out_cases: 0,
        redacted_secrets: count.secrets,
        redacted_paths: count.paths,
      },
      warnings: warnings.map((w) => w.slice(0, 500)),
    },
  );
}

// ---- Validation --------------------------------------------------------------------------

const hasHeldOut = (v: unknown): boolean =>
  Array.isArray(v)
    ? v.some(hasHeldOut)
    : v !== null && typeof v === 'object'
      ? Object.entries(v).some(
          ([k, x]) => (k === 'held_out' && x === true) || hasHeldOut(x),
        )
      : false;

/**
 * Checks a bundle from its files alone, the way a receiver could: the manifest parses and
 * matches every file and hash, the prompts exist in order with earlier prerequisites, every
 * relative Markdown link lands on a file in the bundle, and nothing that must stay out is in.
 * Returns the problems found; an empty list means the bundle is whole.
 */
export function validateRunbook(files: readonly RunbookFile[]): string[] {
  const out: string[] = [];
  const byPath = new Map<string, Buffer>();
  for (const f of files) {
    if (byPath.has(f.path)) out.push(`${f.path} appears twice.`);
    byPath.set(f.path, f.content);
  }
  if (files.length > RUNBOOK_MAX_FILES + 1)
    out.push(`The bundle has more than ${RUNBOOK_MAX_FILES} files.`);
  if (files.reduce((n, f) => n + f.content.length, 0) > RUNBOOK_MAX_BYTES)
    out.push('The bundle is larger than its size limit.');
  const raw = byPath.get('manifest.json');
  if (!raw) return [...out, 'manifest.json is missing.'];
  let manifest: RunbookManifest;
  try {
    manifest = RunbookManifestSchema.parse(JSON.parse(raw.toString('utf8')));
  } catch {
    return [...out, 'manifest.json does not match the runbook/1 format.'];
  }
  const listed = new Set(manifest.files.map((f) => f.path));
  for (const f of manifest.files) {
    const content = byPath.get(f.path);
    if (!content) out.push(`${f.path} is listed but missing.`);
    else if (content.length !== f.bytes || sha256(content) !== f.sha256)
      out.push(`${f.path} does not match its recorded hash.`);
  }
  for (const p of byPath.keys())
    if (p !== 'manifest.json' && !listed.has(p))
      out.push(`${p} is not listed in the manifest.`);
  if (
    manifest.files.some(
      (f, i) => i > 0 && manifest.files[i - 1]!.path >= f.path,
    )
  )
    out.push('The manifest’s files are not sorted by path.');
  if (bundleHash(manifest.files) !== manifest.bundle_hash)
    out.push('The bundle hash does not match the listed files.');
  for (const need of ['README.md', 'CONTRACT.md', 'RECOVERY.md'])
    if (!listed.has(need)) out.push(`${need} is missing.`);
  const seen = new Set<string>();
  manifest.prompts.forEach((p, i) => {
    if (p.order !== i + 1) out.push(`Prompt ${p.path} is out of order.`);
    if (!listed.has(p.path)) out.push(`Prompt ${p.path} is missing.`);
    for (const need of p.prerequisites)
      if (!seen.has(need))
        out.push(
          `Prompt ${p.path} needs ${need}, which does not come before it.`,
        );
    seen.add(p.path);
    const text = byPath.get(p.path)?.toString('utf8') ?? '';
    for (const h of [
      '## Prerequisites',
      '## Scope',
      '## Expected artifacts',
      '## Completion gate',
      '## Prompt',
    ])
      if (!text.includes(`\n${h}\n`))
        out.push(`${p.path} has no “${h.slice(3)}” part.`);
  });
  for (const [path, content] of byPath) {
    const text = content.toString('utf8');
    if (path.endsWith('.md')) {
      const dir = path.includes('/')
        ? path.slice(0, path.lastIndexOf('/'))
        : '';
      // Links outside code: fenced blocks and code spans are text, not links.
      const prose = text
        .replace(/^(`{3,})[^\n]*\n[\s\S]*?^\1`*\s*$/gm, '')
        .replace(/(?<!`)(`+)(?!`)[^\n]*?(?<!`)\1(?!`)/g, '');
      for (const m of prose.matchAll(/(?<!\\)\]\(([^)\s]+)\)/g)) {
        const target = m[1]!.split('#')[0]!;
        if (!target) continue;
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) {
          out.push(
            `${path} links outside the bundle (${target.slice(0, 80)}).`,
          );
          continue;
        }
        const parts = dir ? dir.split('/') : [];
        for (const seg of target.split('/'))
          if (seg === '..') parts.pop();
          else if (seg !== '.') parts.push(seg);
        if (!byPath.has(parts.join('/')))
          out.push(`${path} links to ${target}, which is not in the bundle.`);
      }
    }
    // Markdown is scanned as a reader sees it, with escapes removed: record text is escaped
    // after it is redacted ("ghp\_…", "postgres\://…"), and an escape must neither hide a
    // credential nor make harmless text ("/home/\<user\>/") look like a personal path.
    const seen = path.endsWith('.md')
      ? text.replace(/\\([!-/:-@[-`{-~])/g, '$1')
      : text;
    const count: Redactions = { secrets: 0, paths: 0 };
    redactText(seen, count);
    if (count.secrets) out.push(`${path} contains a credential-like value.`);
    if (count.paths) out.push(`${path} contains a personal folder path.`);
    // A held-out case is data, so it is looked for in the data, not as a phrase in any text
    // (an expected output may legitimately contain the words).
    if (path.endsWith('.json')) {
      try {
        if (hasHeldOut(JSON.parse(text)))
          out.push(`${path} contains a held-out case.`);
      } catch {
        out.push(`${path} is not valid JSON.`);
      }
    }
  }
  return out;
}

// ---- Archive -----------------------------------------------------------------------------

/**
 * A ZIP archive of the bundle with no compression and fixed dates, so the same bundle is the
 * same bytes. Paths are UTF-8; every operating system opens it without extra tools.
 */
export function writeZip(files: readonly RunbookFile[]): Buffer {
  const DATE = 0x21; // 1980-01-01
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const name = Buffer.from(f.path, 'utf8');
    const crc = crc32(f.content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.content.length, 18);
    local.writeUInt32LE(f.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(DATE, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(f.content.length, 20);
    head.writeUInt32LE(f.content.length, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE(0o100644 * 0x10000, 38);
    head.writeUInt32LE(offset, 42);
    parts.push(local, name, f.content);
    central.push(head, name);
    offset += 30 + name.length + f.content.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

/** Reads an archive writeZip wrote (stored entries only); anything else is refused. */
export function readZip(archive: Buffer): RunbookFile[] {
  const files: RunbookFile[] = [];
  let at = 0;
  while (at + 4 <= archive.length && archive.readUInt32LE(at) === 0x04034b50) {
    if (archive.readUInt16LE(at + 8) !== 0)
      throw new Error('Compressed entries are not supported.');
    const size = archive.readUInt32LE(at + 18);
    const nameLength = archive.readUInt16LE(at + 26);
    const extra = archive.readUInt16LE(at + 28);
    const start = at + 30 + nameLength + extra;
    if (start + size > archive.length) throw new Error('Truncated archive.');
    const content = archive.subarray(start, start + size);
    if (crc32(content) !== archive.readUInt32LE(at + 14))
      throw new Error('A file in the archive is damaged.');
    files.push({
      path: archive.subarray(at + 30, at + 30 + nameLength).toString('utf8'),
      content: Buffer.from(content),
    });
    at = start + size;
  }
  if (!files.length) throw new Error('Not a runbook archive.');
  return files;
}
