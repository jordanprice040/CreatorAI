import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BenchmarkManifestSchema,
  parseRoleAnswer,
  unwrapOneJsonFence,
} from '@creator/contracts';
import { BUILD_ROLE_PROMPTS } from '@creator/domain';

const root = new URL('../../', import.meta.url);
const bench = (name: string) =>
  BenchmarkManifestSchema.parse(
    JSON.parse(
      readFileSync(
        new URL(`config/connections/benchmarks/${name}.json`, root),
        'utf8',
      ),
    ),
  );

const ANSWER = '{"verdict":"approve","findings":[]}';

test('ADR-0110: exactly one json or bare fence around the whole answer is accepted', () => {
  for (const text of [
    `\`\`\`json\n${ANSWER}\n\`\`\``,
    `\`\`\`\n${ANSWER}\n\`\`\``,
    `\n  \`\`\`json\n${ANSWER}\n\`\`\`\n`,
    `\`\`\`json\r\n${ANSWER}\r\n\`\`\``,
    `\`\`\`json\n{\n  "verdict": "approve",\n  "findings": []\n}\n\`\`\``,
    // Backticks inside a JSON string (a README in a patch) do not end the fence.
    `\`\`\`json\n{"content":"\`\`\`py\\nx\\n\`\`\`"}\n\`\`\``,
  ]) {
    const r = parseRoleAnswer(text, 'one_json_fence');
    assert.equal(r.fenced, true, text);
    assert.equal(typeof r.json, 'object');
  }
  // A raw answer stays strict JSON and is not marked fenced.
  assert.deepEqual(parseRoleAnswer(ANSWER, 'one_json_fence'), {
    json: JSON.parse(ANSWER),
    fenced: false,
  });
});

test('ADR-0110: any other surrounding text, a second fence or another language still fails', () => {
  for (const text of [
    `Here is the answer:\n\`\`\`json\n${ANSWER}\n\`\`\``,
    `\`\`\`json\n${ANSWER}\n\`\`\`\nDone.`,
    `\`\`\`json\n${ANSWER}\n\`\`\`\n\`\`\`json\n${ANSWER}\n\`\`\``,
    `\`\`\`json\n${ANSWER}\n\`\`\`\n\`\`\``,
    `\`\`\`json\n${ANSWER}\n\`\`\` trailing`,
    `\`\`\`javascript\n${ANSWER}\n\`\`\``,
    `\`\`\`JSON\n${ANSWER}\n\`\`\``,
    `\`\`\`json ${ANSWER}\`\`\``,
    `\`\`\`json\n${ANSWER}`,
    `\`\`\`json\n\n\`\`\``,
    `~~~json\n${ANSWER}\n~~~`,
    `\`${ANSWER}\``,
  ])
    assert.throws(
      () => parseRoleAnswer(text, 'one_json_fence'),
      SyntaxError,
      text,
    );
  // Without the wrapping (every earlier benchmark version) a fence fails as before.
  assert.throws(
    () => parseRoleAnswer(`\`\`\`json\n${ANSWER}\n\`\`\``, null),
    SyntaxError,
  );
  assert.equal(unwrapOneJsonFence(ANSWER), null);
});

test('ADR-0110: only build-role benchmarks may accept a fence, and earlier versions stay strict', () => {
  const reviewer = bench('t12-reviewer-v2');
  assert.equal('answer_wrapping' in reviewer, false);
  assert.equal('answer_wrapping' in bench('t12-builder-v1'), false);
  assert.throws(
    () =>
      BenchmarkManifestSchema.parse({
        ...bench('summarization-synthetic-v1'),
        answer_wrapping: 'one_json_fence',
      }),
    /Only build-role benchmarks/,
  );
  assert.throws(() =>
    BenchmarkManifestSchema.parse({
      ...reviewer,
      answer_wrapping: 'any_text',
    }),
  );
});

test('ADR-0110: t12-builder-v3 and t12-reviewer-v3 are their sources plus the fence marker', () => {
  for (const [from, to, role] of [
    ['t12-builder-v1', 't12-builder-v3', 'builder'],
    ['t12-reviewer-v2', 't12-reviewer-v3', 'reviewer'],
  ] as const) {
    const a = bench(from);
    const b = bench(to);
    assert.equal(b.name, to);
    assert.equal(b.answer_wrapping, 'one_json_fence');
    assert.deepEqual(
      [b.format, b.fixture, b.task_class, b.data_class],
      [a.format, a.fixture, a.task_class, a.data_class],
    );
    assert.deepEqual(b.cases, a.cases, `${to} keeps ${from}'s cases`);
    // The copy serves the current role prompt, so its decided qualification admits the role.
    for (const c of b.cases)
      assert.equal(c.input[0]!.text, BUILD_ROLE_PROMPTS[role]);
    assert.match(b.provenance, /ADR-0110/);
    assert.match(b.provenance, /7c054251/);
  }
});
