import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {
  BenchmarkManifestSchema,
  SPEC_DRAFT_INSTRUCTIONS,
  SPEC_DRAFT_INSTRUCTIONS_VERSION,
  checkedAgainst,
  draftComparable,
  draftCounts,
  draftedMarkText,
  heldOutOf,
  pickHeldOut,
  readEdgeCase,
  readExplanation,
  readSpecDraft,
  specCaseProblems,
  specDraftInput,
  type BenchmarkCheck,
  type SpecContent,
} from '@creator/contracts';
import {
  SPEC_BENCHMARK_PROGRAMS,
  checkOutput,
  gradeSpecCases,
  canonicalHash,
} from '@creator/domain';
import { currentForSpecDraftRole } from '@creator/db';

// spec-fields.ts has no imports, so it loads without a browser (as in web-spec-form.test.ts).
type Draft = Record<string, any>;
type Route = { connection_id: string; model_id: string };
const web = (() => {
  const code = ts.transpileModule(
    readFileSync('apps/web/src/spec-fields.ts', 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const exports = {} as {
    checkForDraft: (
      d: Draft,
      i: number,
    ) => { check: Draft | null; error: string | null };
    draftRoute: (r: Route[], c: Route | null, p: string | null) => Route | null;
    draftToContent: (d: Draft) => { errors: unknown };
    emptySpecDraft: (p: Record<string, string>) => Draft;
    problemKey: (
      p: { check: string; list: string | null; index: number | null },
      keys: string[],
    ) => string | null;
  };
  new Function('exports', code)(exports);
  return exports;
})();
const {
  checkForDraft,
  draftRoute,
  draftToContent,
  emptySpecDraft,
  problemKey,
} = web;

// ADR-0107 (B2): the rules behind model-drafted specs, without a database: reading a reply,
// the studio's case checks and held-out pick, the drafting input, and the frozen spec-cases-v1
// benchmark whose grader runs drafted cases against the studio's own programs.

const UPKEEP: SpecContent['maintenance'] = {
  owner: 'Jordan',
  obligations: ['Check that the acceptance checks still pass'],
  review_interval: 'Every 3 months',
};

type Input = { args: string[]; stdin: string };

/** Inputs that, run through the reference, make a case set catching every broken version. */
const GOOD: Record<string, Input[][]> = {
  wordtally: [
    [
      { args: [], stdin: 'one two\tthree\n' },
      { args: [], stdin: '' },
      { args: ['--lines'], stdin: 'a\nb\n' },
    ],
    [
      { args: ['-x'], stdin: '' },
      { args: ['--lines', '--lines'], stdin: '' },
    ],
  ],
  slug: [
    [
      { args: ['Hello,  World!'], stdin: '' },
      { args: ['--Hi--'], stdin: '' },
      { args: ['ABC 123'], stdin: '' },
    ],
    [
      { args: ['!!!'], stdin: '' },
      { args: [], stdin: '' },
    ],
  ],
  roman: [
    [
      { args: ['4'], stdin: '' },
      { args: ['1994'], stdin: '' },
      { args: ['007'], stdin: '' },
    ],
    [
      { args: ['4000'], stdin: '' },
      { args: ['0'], stdin: '' },
      { args: [], stdin: '' },
    ],
  ],
  csvsum: [
    [
      { args: ['b'], stdin: 'a,b\n1,-2\n\n3,4\n' },
      { args: ['a'], stdin: 'a\nx\n' },
      { args: ['b'], stdin: 'a,b\n1\n' },
    ],
    [
      { args: ['z'], stdin: 'a,b\n' },
      { args: [], stdin: '' },
    ],
  ],
  dedupe: [
    [
      { args: [], stdin: 'b\na\nb\n' },
      { args: ['-i'], stdin: 'Ann\nann\n' },
      { args: [], stdin: 'x\ny' },
    ],
    [
      { args: [], stdin: 'Ann\nann\n' },
      { args: ['-c'], stdin: 'a\na\n' },
      { args: ['-z'], stdin: '' },
    ],
  ],
  rle: [
    [
      { args: ['abc'], stdin: '' },
      { args: ['aaaaaaaaaaaa'], stdin: '' },
    ],
    [
      { args: ['a1'], stdin: '' },
      { args: ['aA'], stdin: '' },
      { args: [], stdin: '' },
    ],
  ],
  grade: [
    [
      { args: [], stdin: '90\n' },
      { args: [], stdin: '100\n' },
      { args: [], stdin: '80\n\n70\n' },
    ],
    [
      { args: [], stdin: '50\n' },
      { args: [], stdin: 'abc\n' },
      { args: ['x'], stdin: '' },
    ],
  ],
  brackets: [
    [
      { args: ['(]'], stdin: '' },
      { args: ['a)'], stdin: '' },
      { args: ['(('], stdin: '' },
    ],
    [
      { args: ['f(x)'], stdin: '' },
      { args: ['{[()]}'], stdin: '' },
      { args: [], stdin: '' },
    ],
  ],
};

/** A whole draft_spec reply whose cases are `groups`, with outputs from `run`. */
function reply(
  groups: Input[][],
  run: (
    args: readonly string[],
    stdin: string,
  ) => {
    stdout: string;
    exit_code: number;
  },
) {
  return JSON.stringify({
    title: 'Drafted tool',
    notes: 'Assumed ASCII input.',
    spec: {
      audience: 'Volunteers',
      problem_statement: 'They need the tool.',
      user_flows: [{ key: 'F1', name: 'Run it', steps: ['Run the tool'] }],
      scope: ['Exactly the rules in the request'],
      non_goals: ['A graphical interface'],
      acceptance_checks: groups.map((g, i) => ({
        key: `A${i + 1}`,
        flow: 'F1',
        statement: `Behaviour ${i + 1}`,
        measure: 'Exact output and exit code',
        method: 'automated_test',
        cases: g.map((x) => ({ ...x, ...run(x.args, x.stdin) })),
      })),
      risks: [],
      tasks: [
        {
          key: 'T1',
          title: 'Write the tool',
          role: 'builder',
          file_scope: ['src'],
          depends_on: [],
          acceptance: groups.map((_, i) => `A${i + 1}`),
          deliverable: 'src/main.py',
        },
      ],
    },
  });
}

const manifest = BenchmarkManifestSchema.parse(
  JSON.parse(
    readFileSync(
      new URL(
        '../../config/connections/benchmarks/spec-cases-v1.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ),
);
const checkOf = (program: string) =>
  manifest.cases.find((c) => c.case_id === `spec-${program}`)!.check as Extract<
    BenchmarkCheck,
    { kind: 'spec_cases_contract' }
  >;

test('reading a drafted spec: fenced JSON reads, keys are renumbered with their references, held-out ticks are cleared and unreadable cases dropped', () => {
  const text =
    'Here it is:\n```json\n' +
    JSON.stringify({
      title: 'Word counter',
      notes: 'Check the usage line.',
      spec: {
        audience: 'Volunteers',
        problem_statement: 'Counting words.',
        user_flows: [{ key: 'F7', name: 'Count', steps: ['Paste text'] }],
        scope: ['Words are runs of non-space'],
        non_goals: ['Languages'],
        acceptance_checks: [
          {
            key: 'A9',
            flow: 'F7',
            statement: 'Counts words',
            measure: 'Output',
            method: 'automated_test',
            cases: [
              {
                args: [],
                stdin: 'a b\n',
                stdout: 'words: 2\n',
                exit_code: 0,
                held_out: true,
              },
              { args: 'not a list', stdout: 3 },
            ],
          },
        ],
        risks: [],
        tasks: [
          {
            key: 'X',
            title: 'Build',
            role: 'builder',
            file_scope: ['SRC'],
            depends_on: [],
            acceptance: ['A9'],
            deliverable: 'src/main.py',
          },
        ],
      },
    }) +
    '\n```';
  const r = readSpecDraft(text, UPKEEP);
  assert.ok(r.ok, r.ok ? '' : r.reason);
  assert.equal(r.title, 'Word counter');
  assert.equal(r.notes, 'Check the usage line.');
  const a = r.content.acceptance_checks[0]!;
  assert.deepEqual([a.key, a.flow], ['A1', 'F1']);
  assert.equal(a.cases?.length, 1);
  assert.equal(a.cases?.[0]?.held_out, false, 'the studio picks held-out');
  assert.deepEqual(r.dropped, ['A1 case 2: not a readable case']);
  assert.deepEqual(r.content.tasks[0]!.acceptance, ['A1']);
  assert.deepEqual(r.content.tasks[0]!.file_scope, ['src']);
  assert.deepEqual(r.content.maintenance, UPKEEP);
  assert.equal(readSpecDraft('Sure, here is a spec!', UPKEEP).ok, false);
  const broken = readSpecDraft(
    JSON.stringify({ spec: { tasks: [], acceptance_checks: [] } }),
    UPKEEP,
  );
  assert.equal(broken.ok, false);
  assert.match(broken.ok ? '' : broken.reason, /does not fit the spec form/);
});

test('edge case and explanation replies: only the asked shape is read', () => {
  const cli = readEdgeCase(
    JSON.stringify({
      case: {
        args: ['--lines'],
        stdin: '',
        stdout: 'words: 0\nlines: 0\n',
        exit_code: 0,
      },
      why: 'Empty input with the flag.',
    }),
    false,
  );
  assert.ok(cli.ok && cli.case && !cli.browser_case);
  assert.equal(readEdgeCase('{"case": {"page": "/"}}', false).ok, false);
  const web = readEdgeCase(
    JSON.stringify({
      case: { page: '/', steps: ['click #add', 'expect count li = 1'] },
      why: 'One item.',
    }),
    true,
  );
  assert.ok(web.ok && web.browser_case && !web.case);
  assert.equal(
    readEdgeCase(
      JSON.stringify({ case: { page: '/', steps: ['dance #x'] } }),
      true,
    ).ok,
    false,
  );
  assert.deepEqual(readExplanation('{"explanation": " It checks X. "}'), {
    ok: true,
    explanation: 'It checks X.',
  });
  assert.equal(readExplanation('It checks X.').ok, false);
});

test('the studio’s case checks: contradictions are errors; repeats, odd output and a missing held-out case are named in plain words', () => {
  const r = readSpecDraft(
    reply(
      [
        [
          { args: [], stdin: 'a\n' },
          { args: [], stdin: 'b\n' },
        ],
      ],
      () => ({ stdout: 'x \n', exit_code: 0 }),
    ),
    UPKEEP,
  );
  assert.ok(r.ok);
  const c = structuredClone(r.content);
  const cases = c.acceptance_checks[0]!.cases!;
  cases.push({ ...cases[0]!, stdout: 'y\n' });
  cases.push({ ...cases[1]! });
  cases.push({
    args: [' pad'],
    stdin: '',
    stdout: 'no newline',
    exit_code: 0,
    held_out: false,
  });
  const codes = specCaseProblems(c).map((p) => `${p.code}:${p.level}`);
  assert.ok(codes.includes('contradicts:error'), codes.join());
  assert.ok(codes.includes('repeats:warning'));
  assert.ok(codes.includes('trailing_space:warning'));
  assert.ok(codes.includes('no_final_newline:warning'));
  assert.ok(codes.includes('argument_space:warning'));
  assert.ok(codes.includes('no_held_out:error'));
  const contra = specCaseProblems(c).find((p) => p.code === 'contradicts')!;
  assert.deepEqual(
    [contra.check, contra.list, contra.index],
    ['A1', 'cases', 2],
  );
  assert.match(
    contra.text,
    /A1 case 3 runs the same arguments and input as A1 case 1/,
  );
  // The form shows a case's problems beside that case.
  assert.equal(problemKey(contra, ['A1']), 'checks.0.cases.2');
  assert.equal(
    problemKey({ check: 'A1', list: null, index: null }, ['A1']),
    'checks.0',
  );
  assert.equal(
    problemKey({ check: 'A5', list: null, index: null }, ['A1']),
    null,
  );
});

test('the held-out pick: about a third of each check at random, at least one per builder task, and a pick is told from a change', () => {
  const r = readSpecDraft(
    reply(GOOD.dedupe!, SPEC_BENCHMARK_PROGRAMS.dedupe!.run),
    UPKEEP,
  );
  assert.ok(r.ok);
  const seq = (xs: number[]) => {
    let i = 0;
    return () => xs[i++ % xs.length]!;
  };
  const a = pickHeldOut(r.content, seq([0.1, 0.9, 0.5, 0.3]));
  const b = pickHeldOut(r.content, seq([0.8, 0.2, 0.6, 0.4]));
  for (const p of [a, b]) {
    // Two checks of three cases: one held out from each.
    assert.equal(p.picks.length, 2);
    assert.deepEqual(p.picks.map((x) => x.check).sort(), ['A1', 'A2']);
    assert.deepEqual(heldOutOf(p.content), p.picks);
    assert.equal(
      specCaseProblems(p.content).some((x) => x.code === 'no_held_out'),
      false,
    );
  }
  // A check with one case gives none, but the task still gets one held out.
  const one = structuredClone(r.content);
  one.acceptance_checks = [
    {
      ...one.acceptance_checks[0]!,
      cases: one.acceptance_checks[0]!.cases!.slice(0, 1),
    },
  ];
  one.tasks[0]!.acceptance = ['A1'];
  assert.equal(pickHeldOut(one, () => 0.5).picks.length, 1);
  // What the build is checked against says which cases are held out.
  const lines = checkedAgainst(a.content).flatMap((x) => x.lines);
  assert.equal(lines.filter((l) => l.held_out).length, 2);
  assert.deepEqual(draftCounts(a.content), {
    checks: 2,
    cases: 6,
    held_out: 2,
  });
  // A spec compared with its draft ignores held-out ticks and upkeep.
  assert.equal(
    canonicalHash(draftComparable(a.content)),
    canonicalHash(
      draftComparable({
        ...r.content,
        maintenance: { ...UPKEEP, owner: 'Someone' },
      }),
    ),
  );
});

test('the drafting input: request text is escaped data under the fixed instructions, and a too-long request is refused', () => {
  const p = SPEC_BENCHMARK_PROGRAMS.slug!;
  const base = {
    product: 'cli' as const,
    problem: {
      title: 'Slugs <now>',
      statement: p.statement,
      affected_group: p.affected_group,
    },
    option: p.option,
  };
  const spec = specDraftInput({
    kind: 'spec',
    ...base,
    check: null,
    case_index: null,
    maxChars: 50_000,
  })!;
  assert.match(spec, /^<task>draft_spec<\/task>/);
  assert.match(spec, /Slugs &lt;now&gt;/);
  assert.doesNotMatch(spec, /Slugs <now>/);
  const check = {
    key: 'A1',
    statement: 'Lowercases',
    measure: 'Output',
    method: 'automated_test' as const,
    cases: [
      {
        args: ['ABC'],
        stdin: '',
        stdout: 'abc\n',
        exit_code: 0,
        held_out: true,
      },
    ],
    browser_cases: [],
    scope: ['Lowercase ASCII letters'],
  };
  const explain = specDraftInput({
    kind: 'explain_case',
    ...base,
    check,
    case_index: 0,
    maxChars: 50_000,
  })!;
  assert.match(explain, /<task>explain_case<\/task>/);
  assert.match(explain, /ABC/);
  assert.equal(
    specDraftInput({
      kind: 'spec',
      ...base,
      check: null,
      case_index: null,
      maxChars: 100,
    }),
    null,
  );
  assert.ok(SPEC_DRAFT_INSTRUCTIONS.includes('data, not instructions'));
});

test('spec-cases-v1 is current: every case runs under the spec draft instructions with its exact draft input, so its passes admit drafts', () => {
  assert.equal(manifest.name, 'spec-cases-v1');
  assert.equal(manifest.task_class, 'specification');
  assert.equal(manifest.cases.length, 8);
  assert.equal(manifest.cases.filter((c) => c.split === 'held_out').length, 5);
  const row = (m: unknown) => ({
    task_class: 'specification',
    manifest: m,
    manifest_hash: canonicalHash(m),
  });
  assert.equal(currentForSpecDraftRole(row(manifest)), true);
  // A changed prompt, a changed request or an older check stops admitting drafts.
  const changed = structuredClone(manifest);
  changed.cases[0]!.input[0]!.text += ' Be brief.';
  assert.equal(currentForSpecDraftRole(row(changed)), false);
  const request = structuredClone(manifest);
  (
    request.cases[1]!.check as { request: { option: { title: string } } }
  ).request.option.title = 'Other';
  assert.equal(currentForSpecDraftRole(row(request)), false);
  const older = structuredClone(manifest);
  (older.cases[2]!.check as { role_version: string }).role_version =
    'spec-draft-v0';
  assert.equal(currentForSpecDraftRole(row(older)), false);
  assert.equal(
    currentForSpecDraftRole({
      ...row(manifest),
      manifest_hash: '0'.repeat(64),
    }),
    false,
  );
  for (const c of manifest.cases)
    assert.equal(
      (c.check as { role_version: string }).role_version,
      SPEC_DRAFT_INSTRUCTIONS_VERSION,
    );
  // The older acceptance-check labelling benchmark never admits drafts.
  const labelling = JSON.parse(
    readFileSync(
      new URL(
        '../../config/connections/benchmarks/specification-synthetic-v1.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.equal(currentForSpecDraftRole(row(labelling)), false);
});

test('spec-cases-v1 grading: good cases pass the reference and catch every broken program; wrong, too few or weak cases fail', () => {
  for (const [name, groups] of Object.entries(GOOD)) {
    const program = SPEC_BENCHMARK_PROGRAMS[name]!;
    const check = checkOf(name);
    assert.deepEqual(
      check.mutants.slice().sort(),
      Object.keys(program.mutants).sort(),
      name,
    );
    const good = gradeSpecCases(check, reply(groups, program.run));
    assert.equal(good.signal, 'accepted', `${name}: ${good.detail}`);
    // Every broken version is catchable, so the bar of three is fair.
    assert.equal(
      good.caught.length,
      check.mutants.length,
      `${name} caught ${good.caught.join()}`,
    );
    assert.equal(
      checkOutput(
        check,
        { text: reply(groups, program.run), json: null },
        {
          succeeded: true,
          reason_code: 'ok',
        },
      ),
      'accepted',
    );
    // An expected output the program does not give fails, whatever the model believed.
    const wrong = gradeSpecCases(
      check,
      reply(groups, (a, s) => {
        const r = program.run(a, s);
        return { ...r, stdout: `${r.stdout}x\n` };
      }),
    );
    assert.equal(wrong.signal, 'acceptance_check_failed', name);
    assert.match(wrong.detail ?? '', /the program gives/);
  }
  const wt = SPEC_BENCHMARK_PROGRAMS.wordtally!;
  const few = gradeSpecCases(
    checkOf('wordtally'),
    reply(
      [
        [
          { args: [], stdin: 'a\n' },
          { args: [], stdin: '' },
        ],
      ],
      wt.run,
    ),
  );
  assert.equal(few.signal, 'acceptance_check_failed');
  assert.match(few.detail ?? '', /Only 2 command-line cases/);
  const weak = gradeSpecCases(
    checkOf('wordtally'),
    reply(
      [
        [
          { args: [], stdin: 'a b\n' },
          { args: [], stdin: 'a b c\n' },
          { args: [], stdin: 'a\n' },
          { args: [], stdin: 'a b c d\n' },
        ],
      ],
      wt.run,
    ),
  );
  assert.equal(weak.signal, 'acceptance_check_failed');
  assert.match(weak.detail ?? '', /caught \d of 4 broken programs/);
  assert.equal(
    gradeSpecCases(checkOf('wordtally'), 'No.').signal,
    'schema_invalid',
  );
  // A contradiction is an error the grade does not look past.
  const contra = JSON.parse(reply(GOOD.wordtally!, wt.run));
  contra.spec.acceptance_checks[0].cases.push({
    ...contra.spec.acceptance_checks[0].cases[0],
    stdout: 'words: 9\n',
  });
  assert.equal(
    gradeSpecCases(checkOf('wordtally'), JSON.stringify(contra)).signal,
    'acceptance_check_failed',
  );
});

test('the form asks about one check at a time and drafts go to a route the server listed', () => {
  const d = emptySpecDraft({
    title: 't',
    audience: 'a',
    problem_statement: 'p',
  });
  d.checks[0]!.statement = 'Counts words';
  assert.match(
    checkForDraft(d, 0).error ?? '',
    /Pick Automated test or Browser check/,
  );
  d.checks[0]!.method = 'automated_test';
  d.checks[0]!.cases = [
    {
      args: '',
      stdin: 'a b',
      stdout: 'words: 2',
      newline: true,
      exit_code: '0',
      held_out: false,
    },
    {
      args: '',
      stdin: '',
      stdout: 'x',
      newline: true,
      exit_code: 'two',
      held_out: false,
    },
  ];
  assert.match(checkForDraft(d, 0).error ?? '', /^Fix case 2 first:/);
  d.checks[0]!.cases[1]!.exit_code = '0';
  d.scope = 'Words are runs of non-space';
  const ok = checkForDraft(d, 0);
  assert.equal(ok.error, null);
  assert.deepEqual(
    ok.check?.cases.map((c: Draft) => c.stdout),
    ['words: 2\n', 'x\n'],
  );
  assert.deepEqual(ok.check?.scope, ['Words are runs of non-space']);
  assert.equal(checkForDraft(d, 3).error, 'That check is not in the form.');
  // The whole form need not be valid to ask about one check.
  assert.ok(draftToContent(d).errors);

  const routes = [
    { connection_id: 'c1', model_id: 'm1' },
    { connection_id: 'c2', model_id: 'm2' },
  ];
  assert.equal(draftRoute(routes, null, null), routes[0]);
  assert.equal(
    draftRoute(routes, { connection_id: 'c2', model_id: 'm2' }, null),
    routes[1],
  );
  assert.equal(
    draftRoute(routes, { connection_id: 'c9', model_id: 'm9' }, null),
    routes[0],
  );
  assert.equal(draftRoute(routes, null, 'c2/m2'), routes[1]);
  assert.equal(
    draftRoute([], { connection_id: 'c1', model_id: 'm1' }, null),
    null,
  );

  assert.equal(
    draftedMarkText({
      drafts: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          kind: 'spec',
          model_id: 'm1',
        },
      ],
      edited: true,
      held_out: 'changed',
    }),
    'Drafted by m1, checked by you and edited; held-out cases picked by the studio and changed by you.',
  );
});
