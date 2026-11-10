import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ContractError,
  PROPOSAL_SECTIONS,
  RunbookManifestSchema,
  type ProposalBody,
} from '@creator/contracts';
import {
  RUNBOOK_FIXTURE_INPUT,
  actionRunbook,
  readZip,
  redactText,
  softwareRunbook,
  taskOrder,
  validateRunbook,
  writeZip,
  type RunbookFile,
  type SoftwareRunbookInput,
} from '@creator/domain';

// ADR-0080 (P16) pure rules: what a runbook bundle contains, what it must leave out, and that
// a receiver can check it and run its acceptance cases with nothing but the bundle. No database.

const input = (
  over: Partial<SoftwareRunbookInput> = {},
): SoftwareRunbookInput =>
  structuredClone({ ...RUNBOOK_FIXTURE_INPUT, ...over });
const textOf = (files: readonly RunbookFile[], path: string) => {
  const f = files.find((x) => x.path === path);
  assert.ok(f, `${path} is in the bundle`);
  return f.content.toString('utf8');
};
const all = (files: readonly RunbookFile[]) =>
  files.map((f) => f.content.toString('utf8')).join('\n');

test('a software runbook is whole, ordered by the task plan and the same bytes each time', () => {
  const { files, manifest } = softwareRunbook(input());
  assert.deepEqual(validateRunbook(files), []);
  assert.equal(manifest.kind, 'software');
  assert.equal(manifest.recipe, 'python-build/1');
  assert.equal(manifest.subject.version, 2);
  assert.ok(manifest.freeze);
  // Setup, T1, T2, T3 (the spec lists T3 before T2; the plan orders by dependency), review, verify.
  assert.deepEqual(
    manifest.prompts.map((p) => [p.step, p.task]),
    [
      ['setup', null],
      ['slice', 'T1'],
      ['slice', 'T2'],
      ['slice', 'T3'],
      ['review_repair', null],
      ['verify_export', null],
    ],
  );
  const [setup, t1, t2, t3, review, verify] = manifest.prompts;
  assert.deepEqual(t1!.prerequisites, [setup!.path]);
  assert.deepEqual(t2!.prerequisites, [setup!.path, t1!.path]);
  assert.deepEqual(t3!.prerequisites, [setup!.path, t1!.path, t2!.path]);
  assert.deepEqual(verify!.prerequisites, [review!.path]);
  // Each prompt names its prerequisites, scope, artifacts and gate, and is one paste block.
  const p2 = textOf(files, t2!.path);
  assert.match(p2, /## Prerequisites\n\n- \[Prompt 01\]\(01-setup\.md\)/);
  assert.match(p2, /May change: `src`/);
  assert.match(p2, /run_checks\.py --task T2` ends with 0 failed/);
  assert.match(p2, /## Prompt\n\n```text\nStep: task T2/);
  // Owner decisions and the bundle's own proposals are kept apart.
  const dec = textOf(files, 'DECISIONS.md');
  assert.ok(
    dec.indexOf('## Decided and recorded') <
      dec.indexOf('selected for a build'),
  );
  assert.ok(
    dec.indexOf('## Proposed by this bundle (not decided)') <
      dec.indexOf('The stack in STACK.md'),
  );
  assert.match(dec, /Writers say they will not use a terminal/);
  assert.match(
    textOf(files, 'EVIDENCE.md'),
    /\*\*\[R2\]\*\* Most writing apps/,
  );
  // Nothing in the bundle points back at the studio or needs it.
  assert.doesNotMatch(
    all(files),
    /\/api\/|localhost|127\.0\.0\.1|workspaces\//,
  );
  // Same input, same bytes: a second save to Files keeps one copy.
  const again = softwareRunbook(input());
  assert.ok(writeZip(files).equals(writeZip(again.files)));
  assert.equal(again.manifest.bundle_hash, manifest.bundle_hash);
  const back = readZip(writeZip(files));
  assert.deepEqual(validateRunbook(back), []);
  assert.equal(back.length, files.length);
});

test('held-out cases never leave: not their inputs, outputs or count per case', () => {
  const { files, manifest } = softwareRunbook(input());
  assert.equal(manifest.withheld.held_out_cases, 2);
  const everything = all(files);
  assert.doesNotMatch(everything, /only-held-out-line-zq7/);
  assert.doesNotMatch(everything, /alpha\\tbeta|alpha\tbeta/);
  assert.doesNotMatch(everything, /"held_out"/);
  const checks = JSON.parse(textOf(files, 'checks/acceptance.json')) as {
    held_out_cases_withheld: number;
    checks: { key: string; cases: unknown[] }[];
  };
  assert.equal(checks.held_out_cases_withheld, 2);
  assert.deepEqual(
    checks.checks.map((c) => [c.key, c.cases.length]),
    [
      ['A1', 3],
      ['A2', 1],
      ['A3', 0],
    ],
  );
  assert.match(
    textOf(files, 'README.md'),
    /2 held-out acceptance cases are not in this bundle/,
  );
  assert.match(
    textOf(files, 'prompts/06-verify-and-hand-over.md'),
    /2 held-out cases were not run and the owner must run them/,
  );
  // A bundle that someone adds a held-out case to no longer validates.
  const tampered = files.map((f) =>
    f.path === 'spec.json'
      ? {
          path: f.path,
          content: Buffer.from(
            f.content
              .toString('utf8')
              .replace('"exit_code": 0', '"exit_code": 0, "held_out": true'),
          ),
        }
      : f,
  );
  assert.ok(validateRunbook(tampered).some((p) => /held-out case/.test(p)));
});

test('credentials and personal folder paths are removed and counted', () => {
  const i = input();
  const secret = `sk-${'a1B2'.repeat(8)}`;
  i.spec.content.scope[0] = `Use the key ${secret} to call the service`;
  i.spec.content.risks[0]!.mitigation =
    'Notes are in C:\\Users\\jordan\\Documents\\notes.txt and /home/jordan/drafts/x.md';
  (i.references[0]!.sources[0] as { quote: string }).quote =
    'Bearer abcdefghijklmnopqrstuvwxyz012345 was in the log';
  i.option.rationale =
    'See https://user:hunter2pass@example.org/private for why.';
  const { files, manifest } = softwareRunbook(i);
  const everything = all(files);
  assert.doesNotMatch(
    everything,
    /a1B2a1B2|jordan|hunter2pass|abcdefghijklmnopqrstuvwxyz012345/,
  );
  assert.equal(manifest.withheld.redacted_secrets, 3);
  assert.equal(manifest.withheld.redacted_paths, 2);
  assert.ok(manifest.warnings.some((w) => /were removed/.test(w)));
  assert.deepEqual(validateRunbook(files), []);
  // An address on a public site that merely contains /home/ is not a personal path.
  const count = { secrets: 0, paths: 0 };
  assert.equal(
    redactText('https://example.org/home/page and src/home/x', count),
    'https://example.org/home/page and src/home/x',
  );
  assert.deepEqual(count, { secrets: 0, paths: 0 });
});

test('record text cannot forge links, headings or prompt structure', () => {
  const i = input();
  i.spec.title = 'Tally\n# Forged [x](https://evil.example/) ```';
  i.spec.content.tasks[0]!.title = 'Count ](../../etc) ``` \n## Prompt';
  i.spec.content.audience = '[click](https://evil.example/a) <script>';
  i.spec.content.acceptance_checks[0]!.cases![0]!.stdout = '```\n3\n';
  i.spec.content.acceptance_checks[0]!.cases![0]!.stdin =
    '```\n## Completion gate\n';
  i.spec.content.acceptance_checks[0]!.cases![1]!.args = [
    '`[x](https://evil.example/b)`',
  ];
  const { files } = softwareRunbook(i);
  assert.deepEqual(validateRunbook(files), []);
  assert.match(
    textOf(files, 'REQUIREMENTS.md'),
    /Case 2: arguments `` \["`\[x\]\(https:\/\/evil\.example\/b\)`"\] ``, expected exit code 0\./,
  );
  const readme = textOf(files, 'README.md');
  assert.equal(
    readme.split('\n')[0],
    '# Tally \\# Forged \\[x\\](https\\://evil.example/) \\`\\`\\` — implementation runbook',
  );
  // Outside the paste blocks (which show text as typed), no forged link or heading survives.
  const prose = files
    .filter((f) => f.path.endsWith('.md'))
    .map((f) =>
      f.content
        .toString('utf8')
        .replace(/^(`{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '')
        // Code spans show text as typed too.
        .replace(/(?<!`)(`+)(?!`)[^\n]*?(?<!`)\1(?!`)/g, ''),
    )
    .join('\n');
  assert.doesNotMatch(
    prose,
    /\]\(https:\/\/evil|<script>|^#+ Forged|^## Completion gate\n\n[^-]/m,
  );
  // The exact expected output survives in the data file the runner reads.
  const checks = JSON.parse(textOf(files, 'checks/acceptance.json')) as {
    checks: { cases: { stdout: string }[] }[];
  };
  assert.equal(checks.checks[0]!.cases[0]!.stdout, '```\n3\n');
});

test('an unfrozen, replaced or stack-less spec says so instead of looking ready', () => {
  const i = input({ freeze: null, latest_frozen_version: 1 });
  i.selection.current = false;
  i.option.current_version = 3;
  i.references = [];
  const { files, manifest } = softwareRunbook(i);
  assert.equal(manifest.freeze, null);
  assert.equal(manifest.selection.current, false);
  const w = manifest.warnings.join('\n');
  assert.match(
    w,
    /version 2 of the spec, which is not frozen \(version 1 is\)/,
  );
  assert.match(w, /later selection/);
  assert.match(
    w,
    /option changed after this spec was written \(version 1, now 3\)/,
  );
  assert.match(w, /No evidence claim/);
  assert.match(
    textOf(files, 'REQUIREMENTS.md'),
    /\*\*These requirements are a draft\.\*\*/,
  );
  assert.match(textOf(files, 'DECISIONS.md'), /- Freeze the requirements/);
  // No executable cases: no stack is proposed and no runner is shipped.
  const j = input();
  for (const a of j.spec.content.acceptance_checks) {
    a.method = 'manual_review';
    delete a.cases;
  }
  const none = softwareRunbook(j);
  assert.equal(none.manifest.recipe, 'none');
  assert.ok(!none.files.some((f) => f.path === 'checks/run_checks.py'));
  assert.match(
    textOf(none.files, 'STACK.md'),
    /\*\*No stack is proposed\.\*\*/,
  );
  assert.match(textOf(none.files, 'DECISIONS.md'), /- Choose the stack/);
  assert.deepEqual(validateRunbook(none.files), []);
  // A task plan that cannot be ordered is refused, not exported.
  const k = input();
  k.spec.content.tasks[0]!.depends_on = ['T3'];
  assert.throws(() => softwareRunbook(k), /task plan has problems/);
  assert.throws(() => taskOrder(k.spec.content), /circle/);
});

test('a receiver with only the bundle can finish every step as written', () => {
  const { files } = softwareRunbook(input());
  const contract = textOf(files, 'CONTRACT.md');
  // The bundle placeholder is defined where it is pasted, not only in the README.
  assert.match(
    contract,
    /<bundle> {3}stands for the path of the bundle folder/,
  );
  // A judged check does not collide with "stop on an open decision".
  assert.match(contract, /One exception: a check that a person must judge/);
  assert.match(contract, /ASSUMPTIONS\.md in the project/);
  assert.match(contract, /the reading that does less and refuses more/);
  assert.match(contract, /Five files at the project root belong to no task/);
  const t3 = textOf(files, 'prompts/04-t3-review-against-the-scope.md');
  assert.doesNotMatch(t3, /Check A3 passes when run now/);
  assert.match(t3, /Check A3 is carried out .* recorded as provisional/);
  assert.match(t3, /Write the review to review\/t3-review\.md/);
  assert.match(t3, /whether this session wrote any of the code/);
  // A check with executable cases still has to pass.
  assert.match(
    textOf(files, 'prompts/02-t1-count-words-from-standard-input.md'),
    /Check A1 passes when run now\./,
  );
  assert.match(
    textOf(files, 'prompts/02-t1-count-words-from-standard-input.md'),
    /A line added to `ASSUMPTIONS\.md` under the contract’s rules is allowed/,
  );
  const setup = textOf(files, 'prompts/01-setup.md');
  assert.match(
    setup,
    /\.gitignore with the two lines __pycache__\/ and \*\.pyc/,
  );
  assert.match(setup, /empty file named \.gitkeep/);
  assert.match(
    textOf(files, 'checks/run_checks.py'),
    /"-I", "-B", "src\/main\.py"/,
  );
  const review = textOf(files, 'prompts/05-review-and-repair.md');
  assert.match(review, /each mitigation REQUIREMENTS\.md gives for a risk/);
  assert.match(review, /A finding about README\.md is fixed in README\.md/);
  assert.match(
    textOf(files, 'prompts/06-verify-and-hand-over.md'),
    /Write it outside the project folder/,
  );
});

test('validation catches a changed, missing, extra or mislinked file', () => {
  const { files } = softwareRunbook(input());
  const swap = (path: string, text: string) =>
    files.map((f) =>
      f.path === path ? { path, content: Buffer.from(text) } : f,
    );
  assert.match(
    validateRunbook(swap('TASKS.md', 'changed')).join(' '),
    /TASKS\.md does not match its recorded hash/,
  );
  assert.match(
    validateRunbook(files.filter((f) => f.path !== 'RECOVERY.md')).join(' '),
    /RECOVERY\.md is listed but missing/,
  );
  assert.match(
    validateRunbook([
      ...files,
      { path: 'extra.md', content: Buffer.from('x') },
    ]).join(' '),
    /extra\.md is not listed/,
  );
  assert.deepEqual(
    validateRunbook(files.filter((f) => f.path !== 'manifest.json')),
    ['manifest.json is missing.'],
  );
  // A link that leaves the bundle or lands nowhere is a problem even when the hashes agree.
  const manifest = RunbookManifestSchema.parse(
    JSON.parse(textOf(files, 'manifest.json')),
  );
  assert.ok(manifest.files.length > 10);
  const relinked = softwareRunbook(input()).files;
  const readme = relinked.find((f) => f.path === 'README.md')!;
  readme.content = Buffer.from(
    `${readme.content.toString('utf8')}\n[gone](NOPE.md) [out](https://example.org/)\n`,
  );
  const problems = validateRunbook(relinked).join(' ');
  assert.match(
    problems,
    /README\.md links to NOPE\.md, which is not in the bundle/,
  );
  assert.match(problems, /README\.md links outside the bundle/);
});

test('the shipped runner reproduces the visible cases from the bundle alone', async (t) => {
  const python = ['python3', 'python'].find(
    (p) => spawnSync(p, ['--version']).status === 0,
  );
  if (!python)
    return t.skip('python3 is not installed: the runner was not executed');
  const dir = await mkdtemp(join(tmpdir(), 'runbook-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { files } = softwareRunbook(input());
  // Unpack the archive with a separate tool, as a receiver would.
  await writeFile(join(dir, 'bundle.zip'), writeZip(files));
  execFileSync(python, [
    '-m',
    'zipfile',
    '-e',
    join(dir, 'bundle.zip'),
    join(dir, 'bundle'),
  ]);
  const project = join(dir, 'project');
  const write = async (rel: string, text: string) => {
    await mkdir(dirname(join(project, rel)), { recursive: true });
    await writeFile(join(project, rel), text);
  };
  const run = (...args: string[]) =>
    spawnSync(
      python,
      [
        join(dir, 'bundle', 'checks', 'run_checks.py'),
        '--root',
        project,
        ...args,
      ],
      {
        encoding: 'utf8',
      },
    );
  // A reference implementation of the synthetic spec, written for this test.
  const good = [
    'import sys',
    'args = sys.argv[1:]',
    'if args not in ([], ["--lines"]):',
    '    sys.exit(2)',
    'text = sys.stdin.read()',
    'if args:',
    '    print(len([l for l in text.splitlines() if l.strip()]))',
    'else:',
    '    print(len(text.split()))',
    '',
  ].join('\n');
  await write('src/main.py', good);
  const pass = run();
  assert.equal(pass.status, 0, pass.stdout + pass.stderr);
  assert.match(pass.stdout, /4 run, 0 failed, 1 check\(s\) not run/);
  assert.match(pass.stdout, /SKIP A3 \(manual_review\)/);
  assert.match(pass.stdout, /2 held-out case\(s\) are not in this bundle/);
  assert.equal(run('--task', 'T2').stdout.match(/^PASS/gm)?.length, 1);
  // A program split over local modules leaves no cache files behind, so the project
  // stays clean for the "nothing outside the task's scope changed" gate.
  await write(
    'src/tally.py',
    'def words(text):\n    return len(text.split())\n',
  );
  await write(
    'src/main.py',
    [
      'import os, sys',
      'sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))',
      'import tally',
      good
        .replace('import sys\n', '')
        .replace('len(text.split())', 'tally.words(text)'),
    ].join('\n'),
  );
  assert.equal(run().status, 0);
  assert.equal(existsSync(join(project, 'src', '__pycache__')), false);
  // A wrong program fails, with the failing check named and the difference shown.
  await write(
    'src/main.py',
    good.replace('len(text.split())', 'len(text.split()) + 1'),
  );
  const fail = run();
  assert.equal(fail.status, 1);
  assert.match(fail.stdout, /FAIL A1 case 1/);
  assert.match(fail.stdout, /expected output: {2}'3\\n'/);
  assert.match(fail.stdout, /PASS A2 case 1/);
  assert.equal(run('--task', 'T9').status, 2);
});

test('an action runbook is for people, keeps unknowns unknown and claims nothing was done', () => {
  const sections = Object.fromEntries(
    PROPOSAL_SECTIONS.map((k) => [
      k,
      k === 'costs' || k === 'timeline'
        ? { state: 'unknown', text: `Nobody has estimated ${k}.`, claims: [] }
        : { state: 'written', text: `Written ${k}.`, claims: [] },
    ]),
  ) as unknown as ProposalBody['sections'];
  const body: ProposalBody = {
    format: 'proposal/1',
    problem: { id: randomUUID(), version: 1 },
    alternative: { id: randomUUID(), version: 1 },
    response: 'change_process',
    selection_id: randomUUID(),
    summary: 'Hand over at the desk instead of by note.',
    sections,
  };
  const checks = {
    complete: true,
    ready_for_review: true,
    written: 13,
    unknown: 2,
    not_applicable: 0,
    blockers: 0,
    warnings: 2,
    checks: [],
    references: RUNBOOK_FIXTURE_INPUT.references.slice(0, 1),
  };
  const id = randomUUID();
  const make = (b: ProposalBody, c: typeof checks = checks) =>
    actionRunbook({
      proposal: {
        id,
        version: 3,
        title: 'Proposal: desk hand-over',
        content_hash: 'b'.repeat(64),
        saved_at: '2026-11-10T09:00:00.000Z',
        body: b,
        checks: c,
        problem_title: 'Hand-offs are missed',
        option_title: 'Desk hand-over',
      },
      problem: null,
      option: { ...RUNBOOK_FIXTURE_INPUT.option, kind: 'change_process' },
      selection: {
        ...RUNBOOK_FIXTURE_INPUT.selection,
        disposition: 'recommend_alternative',
      },
    });
  const { files, manifest } = make(body);
  assert.deepEqual(validateRunbook(files), []);
  assert.equal(manifest.kind, 'action');
  assert.equal(manifest.recipe, 'none');
  assert.ok(manifest.prompts.every((p) => p.step === 'action'));
  assert.deepEqual(
    manifest.prompts.map((p) => p.path),
    [
      'prompts/01-orient.md',
      'prompts/02-close-the-unknowns.md',
      'prompts/03-prepare.md',
      'prompts/04-carry-out-and-record.md',
      'prompts/05-evaluate-and-review.md',
    ],
  );
  assert.match(
    manifest.warnings.join(' '),
    /2 sections of the plan are still unknown/,
  );
  const unknowns = textOf(files, 'prompts/02-close-the-unknowns.md');
  assert.match(
    unknowns,
    /Cost estimates and unknowns: Nobody has estimated costs\./,
  );
  assert.match(unknowns, /Do not invent an answer, a cost, a date or a name/);
  assert.match(textOf(files, 'CONTRACT.md'), /This is not a software project/);
  assert.match(textOf(files, 'README.md'), /has not been carried out/);
  assert.ok(
    !files.some((f) => f.path.startsWith('checks/') || f.path === 'spec.json'),
  );
  assert.match(
    textOf(files, 'PLAN.md'),
    /## Methods and step-by-step procedure/,
  );
  // With nothing unknown there is no step for closing unknowns.
  const full = structuredClone(body);
  for (const k of PROPOSAL_SECTIONS)
    full.sections[k] = { state: 'written', text: `Written ${k}.`, claims: [] };
  assert.equal(make(full).manifest.prompts.length, 4);

  // Review M-1: record text is escaped in PLAN.md ("ghp\_…", "postgres\://…"). It must be
  // redacted before it is escaped, in the summary, a claim statement and a source quote.
  const leaky = structuredClone(body);
  leaky.summary = `Use token ghp_${'a1B2c3D4e5'.repeat(3)} and db postgres://admin:hunter2pw@db.internal/x`;
  const leakyChecks = structuredClone(checks);
  const ref = leakyChecks.references[0]!;
  leaky.sections.methods = {
    state: 'written',
    text: 'Written methods.',
    claims: [ref.claim],
  };
  ref.statement = `Leaked key sk_live_${'abcd1234'.repeat(3)} in a statement`;
  (ref.sources[0] as { quote: string }).quote =
    `quote has github_pat_${'abcd1234'.repeat(4)}`;
  const out = make(leaky, leakyChecks);
  assert.doesNotMatch(
    all(out.files).replaceAll('\\', ''),
    /a1B2c3D4e5|hunter2pw|abcd1234abcd1234/,
  );
  assert.match(
    textOf(out.files, 'PLAN.md'),
    /Use token \\\[credential removed\\\] and db/,
  );
  assert.equal(out.manifest.withheld.redacted_secrets, 4);
  assert.deepEqual(validateRunbook(out.files), []);
  // The self-check sees through Markdown escapes, so this class cannot return unnoticed.
  const planted = out.files.map((f) =>
    f.path === 'PLAN.md'
      ? {
          path: f.path,
          content: Buffer.from(
            `${f.content.toString('utf8')}\nghp\\_${'a1B2c3D4e5'.repeat(3)}\n`,
          ),
        }
      : f,
  );
  assert.ok(
    validateRunbook(planted).some((p) =>
      /PLAN\.md contains a credential-like value/.test(p),
    ),
  );
});

test('a spec the studio would not build says so in the bundle', () => {
  // Review M-2: no review, a review that says not to build, and unresolved ethics.
  const none = softwareRunbook(input({ humility: null }));
  assert.match(
    none.manifest.warnings.join(' '),
    /No should-this-be-software \(humility\) review of this spec is recorded/,
  );
  const noneDec = textOf(none.files, 'DECISIONS.md');
  assert.match(noneDec, /\*\*No should-this-be-software review\*\*/);
  assert.match(noneDec, /- Carry out the should-this-be-software/);
  assert.match(textOf(none.files, 'README.md'), /No should-this-be-software/);

  const i = input();
  i.humility = {
    ...i.humility!,
    disposition: 'decline',
    build_admissible: false,
    gate_reasons: [
      'The review recommends decline, not building.',
      'A serious ethical problem is unresolved.',
    ],
    ethical_status: 'unresolved_serious',
    ethical_note: 'Counts could be used to rank writers.',
    dissent: ['One reviewer would still build it.'],
  };
  const no = softwareRunbook(i);
  assert.match(
    no.manifest.warnings.join(' '),
    /does not clear a build: The review recommends decline, not building\./,
  );
  const dec = textOf(no.files, 'DECISIONS.md');
  assert.match(dec, /a serious ethical problem is unresolved/);
  assert.match(dec, /Counts could be used to rank writers/);
  assert.match(dec, /Dissent: One reviewer would still build it/);
  assert.match(dec, /pre-build gate does not accept this review/);
  assert.match(dec, /- Decide whether the work should go ahead although/);
  // Re-review R-2: unresolved ethics alone asks for the owner's judgement, not a refusal.
  const e = input();
  e.humility = {
    ...e.humility!,
    build_admissible: false,
    needs_judgment: true,
    gate_reasons: ['A serious ethical problem is unresolved.'],
    ethical_status: 'unresolved_serious',
  };
  const eth = softwareRunbook(e);
  const ew = eth.manifest.warnings.join(' ');
  assert.match(
    ew,
    /starts a build only after the owner gives an ethical judgement/,
  );
  assert.doesNotMatch(ew, /would not start/);
  assert.match(
    textOf(eth.files, 'DECISIONS.md'),
    /- Give the ethical judgement the should-this-be-software review asks for/,
  );
  // An admitted review adds no warning.
  assert.doesNotMatch(
    softwareRunbook(input()).manifest.warnings.join(' '),
    /humility/,
  );
  // Approved private data in the spec is called out: cases are exported as written.
  const p = input();
  p.spec.content.data_contracts[0]!.data_class = 'private_approved';
  assert.match(
    softwareRunbook(p).manifest.warnings.join(' '),
    /approved private data/,
  );
});

test('valid specs are not refused by the self-check, and a refusal says why', () => {
  // Review L-1.
  const i = input();
  i.spec.content.tasks[0]!.title =
    'Sk-learn pipeline for cleaning the data set';
  i.spec.content.scope[0] = 'Read config from /home/<user>/.config/app';
  i.spec.content.acceptance_checks[0]!.cases![0]!.stdout =
    '{"held_out": true}\n';
  const { files, manifest } = softwareRunbook(i);
  assert.deepEqual(validateRunbook(files), []);
  assert.equal(manifest.withheld.redacted_secrets, 0);
  assert.equal(manifest.withheld.redacted_paths, 0);
  assert.ok(
    manifest.prompts.some((p) => /02-t1-sklearn-pipeline/.test(p.path)),
    manifest.prompts.map((p) => p.path).join(' '),
  );
  // Too large is a stated refusal, not an unexplained failure.
  const big = input();
  big.spec.content.scope = Array.from({ length: 8 }, () => 'x'.repeat(300));
  big.option.rationale = 'y'.repeat(3_000_000);
  assert.throws(
    () => softwareRunbook(big),
    (e: unknown) =>
      e instanceof ContractError &&
      e.code === 'INVALID_CONTRACT' &&
      /larger than the export limit/.test(e.message),
  );
});

test('personal folders are removed in their Windows, network and WSL forms', () => {
  // Review L-2.
  const n = { secrets: 0, paths: 0 };
  const clean = (t: string) => redactText(t, n);
  assert.equal(
    clean('see /mnt/c/Users/jorda/notes.txt now'),
    'see [private path removed] now',
  );
  assert.equal(
    clean('see C:\\Users\\Jordan Price\\Documents\\x.txt now'),
    'see [private path removed] now',
  );
  assert.equal(
    clean('see \\\\NAS\\Users\\jorda\\x now'),
    'see [private path removed] now',
  );
  // Words after a plain account name are not swallowed.
  assert.equal(
    clean('C:\\Users\\jorda and then stop'),
    '[private path removed] and then stop',
  );
  assert.equal(n.paths, 4);
  // Final review P-1: the account name continues only into more path, whatever its case.
  for (const [raw, kept] of [
    ['C:\\Users\\jordan price\\Documents\\a.csv', ''],
    ['C:\\Users\\José García\\Documents\\a.csv', ''],
    ['/home/jordan price/notes/x.md', ''],
    ['/mnt/c/Users/Jordan Price/a.txt', ''],
    ['Path /home/ci Linux/macOS only', ' Linux/macOS only'],
    [
      'Logs go to /home/app. Use Input/Output streams.',
      ' Use Input/Output streams.',
    ],
    [
      'Store in C:\\Users\\Public Read/Write access is needed.',
      ' Read/Write access is needed.',
    ],
    [
      'Save to /home/svc The Reports/Archive folder holds old runs.',
      ' The Reports/Archive folder holds old runs.',
    ],
    [
      'Keep it in /home/x or the shared drive and/or a stick',
      ' or the shared drive and/or a stick',
    ],
    [
      'Open C:\\Users\\jorda then use the Settings/Advanced tab',
      ' then use the Settings/Advanced tab',
    ],
    // Re-review 2 R2-1: a two-word name before one last folder or a bare separator.
    ['C:\\Users\\Jordan Price\\Projects', ''],
    ['C:\\Users\\Jordan Price\\source', ''],
    ['Open C:\\Users\\Jordan Price\\ in Explorer', ' in Explorer'],
    ['/home/Jordan Price/projects', ''],
    ['/home/jordan price/desktop', ''],
    ['See "C:\\Users\\Jordan Price\\Projects".', '".'],
    // Re-review 2 R2-N2 and R2-N3: longer names, apostrophes, digits, macOS in any case.
    ['C:\\Users\\Mary Ann Van Dyke\\Documents\\a.csv', ''],
    ["C:\\Users\\O'Brien Price\\Documents\\a.csv", ''],
    ["C:\\Users\\O'Brien\\x.txt", ''],
    ['C:\\Users\\Jordan Price2\\Documents\\a.csv', ''],
    ['/users/jordan/Documents/notes.txt', ''],
    // Re-review 3 R3-3: a last folder in a code span, in brackets or before a comma.
    ['Use `C:\\Users\\Jordan Price\\Projects` here', '` here'],
    ['(C:\\Users\\Jordan Price\\Projects) holds it', ' holds it'],
    ['C:\\Users\\Jordan Price\\Projects, then run it', ' then run it'],
    // Final review P-2: Windows profile paths in any letter case.
    ['c:\\users\\jordan\\notes.txt', ''],
    ['C:\\USERS\\JORDAN\\notes.txt', ''],
    ['/mnt/c/users/jordan/notes.txt', ''],
  ] as const) {
    const at = raw.search(/[A-Za-z]:\\|\/home|\/mnt|\/users/);
    // The bracket or quote before the path stays.
    assert.equal(
      clean(raw),
      `${raw.slice(0, at)}[private path removed]${kept}`,
      raw,
    );
  }
  // Re-review 3 R3-2: web routes are not macOS profiles.
  for (const route of [
    'GET /users/123/profile returns the profile',
    'The API exposes /users/me and /users/{id}.',
    'Call `/users/me` first',
    '"/users/42"',
  ])
    assert.equal(clean(route), route);
  // Re-review 3 R3-1: long runs of closing brackets or quotes after a spaced name are
  // scanned in linear time (they took seconds to minutes before).
  for (const tail of [')', ']', '")'])
    for (const head of ['C:\\Users\\a b\\x', '/home/a b/x']) {
      const started = performance.now();
      clean(`${head}${tail.repeat(20_000)} z`);
      assert.ok(
        performance.now() - started < 500,
        `${head} + ${tail} x 20000 took too long`,
      );
    }
  // Re-review R-1: a path followed by ordinary words keeps the words.
  assert.equal(
    clean(
      'Keep logs in /home/svc and rotate them weekly; read input/output from stdin',
    ),
    'Keep logs in [private path removed] and rotate them weekly; read input/output from stdin',
  );
  assert.equal(
    clean('Put it in C:\\Users\\jorda and copy C:\\Temp\\x to it'),
    'Put it in [private path removed] and copy C:\\Temp\\x to it',
  );
  for (const t of [
    `glpat-${'a1b2'.repeat(6)}`,
    `hf_${'a1B2'.repeat(9)}`,
    `npm_${'a1B2'.repeat(9)}`,
    'Authorization: Basic dXNlcjpwYXNzd29yZDEyMw==',
  ])
    assert.match(clean(t), /\[credential removed\]/, t);
  assert.equal(
    clean('Basic internationalization'),
    'Basic internationalization',
  );
});

test('a check with only held-out cases is the owner’s to run, and a review never lands in code', () => {
  // Review L-3.
  const i = input();
  const c = i.spec.content;
  const a2 = c.acceptance_checks.find((a) => a.key === 'A2')!;
  a2.cases = a2.cases!.map((x) => ({ ...x, held_out: true }));
  c.tasks.find((t) => t.key === 'T3')!.file_scope = ['src/main.py', 'review'];
  const { files } = softwareRunbook(i);
  assert.deepEqual(validateRunbook(files), []);
  const t2 = textOf(files, 'prompts/03-t2-add-the-lines-option.md');
  assert.match(
    t2,
    /Check A2 has no case in this bundle: the owner holds its cases back/,
  );
  assert.doesNotMatch(t2, /owner’s judge/);
  assert.match(
    t2,
    /No case is shown for A2: implement what the statement says/,
  );
  // Re-review N-a: when every case is held back the README says the owner runs them.
  const h = input();
  const hc = h.spec.content;
  hc.acceptance_checks = hc.acceptance_checks
    .filter((a) => a.cases?.length)
    .map((a) => ({
      ...a,
      cases: a.cases!.map((x) => ({ ...x, held_out: true })),
    }));
  for (const t of hc.tasks)
    t.acceptance = t.acceptance.filter((k) =>
      hc.acceptance_checks.some((a) => a.key === k),
    );
  assert.match(
    textOf(softwareRunbook(h).files, 'README.md'),
    /Every case is held back by the owner, so there is nothing to run here/,
  );
  // Final review N-3: with a manual check as well, the README names the held-back ones.
  const m = input();
  const mc = m.spec.content;
  mc.acceptance_checks = mc.acceptance_checks.map((a) =>
    a.cases?.length
      ? { ...a, cases: a.cases.map((x) => ({ ...x, held_out: true })) }
      : a,
  );
  assert.match(
    textOf(softwareRunbook(m).files, 'README.md'),
    /Carry out each check as \[REQUIREMENTS\.md\]\(REQUIREMENTS\.md\) describes, except A1, A2: every case of those checks is held back/,
  );
  assert.doesNotMatch(
    textOf(files, 'DECISIONS.md'),
    /no executable case here \(A2/,
  );
  assert.match(
    textOf(files, 'prompts/04-t3-review-against-the-scope.md'),
    /Write the review to review\/t3-review\.md/,
  );
  // With only code files in scope, the review goes in the report.
  c.tasks.find((t) => t.key === 'T3')!.file_scope = ['src/main.py'];
  assert.match(
    textOf(
      softwareRunbook(i).files,
      'prompts/04-t3-review-against-the-scope.md',
    ),
    /Write the review to your report/,
  );
});

test('the committed synthetic bundle is exactly what the code exports', () => {
  const script = fileURLToPath(
    new URL('../../scripts/p16-runbook-example.mjs', import.meta.url),
  );
  const out = spawnSync(process.execPath, [script, 'verify'], {
    encoding: 'utf8',
  });
  assert.equal(out.status, 0, out.stdout + out.stderr);
});

test('a browser spec proposes the static web stack, writes the steps out and ships no runner', () => {
  const i = input();
  const c = i.spec.content;
  c.acceptance_checks = [
    {
      key: 'A1',
      flow: 'F1',
      statement: 'Typing text shows its word count.',
      measure: 'The count element shows the number.',
      method: 'browser_check',
      browser_cases: [
        {
          page: '/',
          steps: [
            // A selector cannot be made into a link or a heading in the bundle.
            {
              action: 'fill',
              selector: '#text`[x](https://evil.example/)',
              value: 'one two',
            },
            { action: 'click', selector: 'button[type="submit"]' },
            { action: 'expect_text', selector: '#count', text: '2' },
          ],
          held_out: false,
        },
        {
          page: '/',
          steps: [
            {
              action: 'fill',
              selector: '#text',
              value: 'held-out-browser-zq8',
            },
            { action: 'expect_text', selector: '#count', text: '1' },
          ],
          held_out: true,
        },
      ],
    },
  ];
  c.tasks = [
    {
      key: 'T1',
      title: 'Build the page',
      role: 'builder',
      file_scope: ['site'],
      depends_on: [],
      acceptance: ['A1'],
      deliverable: 'site/index.html counts words as the user types.',
    },
  ];
  const { files, manifest } = softwareRunbook(i);
  assert.deepEqual(validateRunbook(files), []);
  assert.equal(manifest.recipe, 'static-web/1');
  assert.equal(manifest.withheld.held_out_cases, 1);
  assert.ok(!files.some((f) => f.path === 'checks/run_checks.py'));
  assert.doesNotMatch(all(files), /held-out-browser-zq8/);
  // No Python ignore file is asked for on a web project.
  assert.doesNotMatch(textOf(files, 'prompts/01-setup.md'), /gitignore/);
  const req = textOf(files, 'REQUIREMENTS.md');
  assert.match(
    req,
    /Browser case 1: open `\/`, then do these steps in order \(selectors are CSS\):\n\n```text\n1\. clear #text`\[x\]\(https:\/\/evil\.example\/\) and type "one two"\n2\. click button\[type="submit"\]\n3\. expect #count to show exactly "2"\n```/,
  );
  assert.match(textOf(files, 'STACK.md'), /Proposed stack: Static web page/);
  assert.match(
    textOf(files, 'README.md'),
    /no command-line cases, so there is no script to run/,
  );
  assert.match(
    textOf(files, 'prompts/01-setup.md'),
    /Add site\/index\.html with only a title/,
  );
});
