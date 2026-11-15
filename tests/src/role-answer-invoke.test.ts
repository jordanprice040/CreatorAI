import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BenchmarkManifestSchema,
  MAX_DROPPED_INVOKE_LINES,
  parseRoleAnswer,
  roleAnswerText,
} from '@creator/contracts';

// ADR-0115: leading invented tool-call lines before the one json fence of a build-role answer.
const ANSWER = '{"verdict":"approve","findings":[]}';
const FENCE = `\`\`\`json\n${ANSWER}\n\`\`\``;
const MODE = 'invoke_lines_then_json_fence' as const;

test('ADR-0115: the H4 answer form parses, and the dropped lines are counted', () => {
  // Record 49fe5782's builder answer began with these two lines before one ```json fence.
  const h4 = `\n<invoke name="note">na</invoke>\n</invoke>\n${FENCE}`;
  assert.deepEqual(parseRoleAnswer(h4, MODE), {
    json: JSON.parse(ANSWER),
    fenced: true,
    dropped_invoke_lines: 2,
  });
  for (const [text, dropped] of [
    [`<invoke>x</invoke>\n${FENCE}`, 1],
    [`</invoke>\n${FENCE}`, 1],
    [
      `  <invoke name="a" id="1">some words</invoke>  \r\n\r\n</invoke>\r\n${FENCE}`,
      2,
    ],
    [`<invoke name="a"></invoke>\n\n${FENCE}\n`, 1],
    [
      `${'</invoke>\n'.repeat(MAX_DROPPED_INVOKE_LINES)}${FENCE}`,
      MAX_DROPPED_INVOKE_LINES,
    ],
  ] as const) {
    const r = parseRoleAnswer(text, MODE);
    assert.equal(r.fenced, true, text);
    assert.equal(r.dropped_invoke_lines, dropped, text);
  }
  // Everything one_json_fence accepts is accepted the same way, with nothing dropped.
  assert.deepEqual(parseRoleAnswer(FENCE, MODE), {
    json: JSON.parse(ANSWER),
    fenced: true,
    dropped_invoke_lines: 0,
  });
  assert.deepEqual(parseRoleAnswer(ANSWER, MODE), {
    json: JSON.parse(ANSWER),
    fenced: false,
    dropped_invoke_lines: 0,
  });
});

test('ADR-0115: any other leading, trailing or inner text still fails', () => {
  for (const text of [
    // Too many lines.
    `${'</invoke>\n'.repeat(MAX_DROPPED_INVOKE_LINES + 1)}${FENCE}`,
    // Raw JSON after the lines: a fence is required.
    `<invoke name="note">na</invoke>\n${ANSWER}`,
    // Prose before, between or after.
    `Sure.\n<invoke name="note">na</invoke>\n${FENCE}`,
    `<invoke name="note">na</invoke>\nHere it is:\n${FENCE}`,
    `<invoke name="note">na</invoke>\n${FENCE}\nDone.`,
    // Lines after the fence are never dropped.
    `${FENCE}\n</invoke>`,
    // Not wholly a one-line call: open tag only, multi-line call, nested or other tags,
    // text beside the tag, look-alike names, other tag names.
    `<invoke name="note">\n${FENCE}`,
    `<invoke name="note">\nna\n</invoke>\n${FENCE}`,
    `<invoke name="note"><parameter>x</parameter></invoke>\n${FENCE}`,
    `<invoke name="note">na</invoke> and more\n${FENCE}`,
    `x <invoke name="note">na</invoke>\n${FENCE}`,
    `<invokex>na</invokex>\n${FENCE}`,
    `<invoke-x>na</invoke>\n${FENCE}`,
    `<function_calls>\n${FENCE}`,
    `</function_calls>\n${FENCE}`,
    `<tool_use>na</tool_use>\n${FENCE}`,
    // Two fences, or a fence that does not close.
    `</invoke>\n${FENCE}\n${FENCE}`,
    `</invoke>\n\`\`\`json\n${ANSWER}`,
    // A BOM before the lines is not whitespace.
    `﻿</invoke>\n${FENCE}`,
  ])
    assert.throws(() => parseRoleAnswer(text, MODE), SyntaxError, text);
});

test('ADR-0115: the other modes are unchanged by the new one', () => {
  const h4 = `<invoke name="note">na</invoke>\n</invoke>\n${FENCE}`;
  assert.throws(() => parseRoleAnswer(h4, 'one_json_fence'), SyntaxError);
  assert.throws(() => parseRoleAnswer(h4, null), SyntaxError);
  // The patch scorer reads the same text: raw when not accepted, the fence's inside when it is.
  assert.equal(roleAnswerText(h4, 'one_json_fence').text, h4);
  assert.equal(roleAnswerText(h4, MODE).text, ANSWER);
});

test('ADR-0115: only build-role benchmarks may name the new mode', () => {
  const base = {
    format: 'route-benchmark/1',
    name: 'x',
    fixture: true,
    data_class: 'synthetic',
    provenance: 'test',
    answer_wrapping: MODE,
    cases: [],
  };
  const issues = (task_class: string) => {
    const r = BenchmarkManifestSchema.safeParse({ ...base, task_class });
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };
  assert.ok(
    issues('summarization').some((m) => /Only build-role benchmarks/.test(m)),
  );
  assert.ok(
    !issues('patch_build').some((m) => /Only build-role benchmarks/.test(m)),
  );
});
