import type { Analysis } from './analysis.js';

/**
 * Standalone tables (CSV and Markdown) and SVG figures from one analysis. Every table row and
 * every figure carries the data label, so a file copied out of context still says what it is.
 */
type Row = Record<string, unknown>;

function flatten(row: Row, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    const name = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v))
      Object.assign(out, flatten(v as Row, name));
    else if (Array.isArray(v))
      out[name] = v
        .map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x)))
        .join('; ');
    else out[name] = v === null || v === undefined ? '' : String(v);
  }
  return out;
}
const csvCell = (s: string) =>
  /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
const mdCell = (s: string) =>
  s.replace(/\|/g, '\\|').replace(/\n/g, ' ') || ' ';

function table(label: string, rows: Row[]) {
  const flat: Record<string, string>[] = rows.length
    ? rows.map((r) => ({ data_label: label, ...flatten(r) }))
    : [{ data_label: label, note: 'No rows.' }];
  const cols = [...new Set(flat.flatMap((r) => Object.keys(r)))];
  const get = (r: Record<string, string>, c: string) => r[c] ?? '';
  return {
    csv:
      [cols, ...flat.map((r) => cols.map((c) => get(r, c)))]
        .map((line) => line.map(csvCell).join(','))
        .join('\n') + '\n',
    md: rows.length
      ? [
          `| ${cols
            .filter((c) => c !== 'data_label')
            .map(mdCell)
            .join(' | ')} |`,
          `| ${cols
            .filter((c) => c !== 'data_label')
            .map(() => '---')
            .join(' | ')} |`,
          ...flat.map(
            (r) =>
              `| ${cols
                .filter((c) => c !== 'data_label')
                .map((c) => mdCell(get(r, c)))
                .join(' | ')} |`,
          ),
        ].join('\n')
      : '_No rows._',
  };
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function svg(
  title: string,
  label: string,
  width: number,
  height: number,
  body: string,
) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + 64}" viewBox="0 0 ${width} ${height + 64}" font-family="sans-serif" font-size="12">\n` +
    `<rect width="100%" height="100%" fill="#ffffff"/>\n` +
    `<rect x="0" y="0" width="${width}" height="26" fill="#fde68a"/>\n` +
    `<text x="8" y="17" font-weight="bold" fill="#7c2d12">${esc(label)}</text>\n` +
    `<text x="8" y="48" font-size="14" fill="#111827">${esc(title)}</text>\n` +
    `<g transform="translate(0,64)">\n${body}\n</g>\n</svg>\n`
  );
}

const ARM_COLORS: Record<string, string> = {
  A: '#2563eb',
  B: '#059669',
  C: '#d97706',
  'D-structured': '#7c3aed',
  'D-open': '#db2777',
};

/** Slot quality per task and arm on the 1-5 scale; unrated slots are listed, not drawn. */
function qualityFigure(a: Analysis) {
  const rows = a.prespecified.decision_quality;
  const tasks = [...new Set(rows.map((r) => String(r.task_key)))].sort();
  const w = 640;
  const left = 80;
  const right = 160;
  const rowH = 36;
  const h = Math.max(1, tasks.length) * rowH + 60;
  const x = (v: number) => left + ((v - 1) / 4) * (w - left - right);
  let body = '';
  for (let v = 1; v <= 5; v++)
    body += `<line x1="${x(v)}" y1="0" x2="${x(v)}" y2="${h - 40}" stroke="#e5e7eb"/><text x="${x(v)}" y="${h - 26}" text-anchor="middle">${v}</text>\n`;
  const missing: string[] = [];
  tasks.forEach((t, i) => {
    const y = i * rowH + 18;
    body += `<text x="8" y="${y + 4}">${esc(t)}</text>\n`;
    rows
      .filter((r) => r.task_key === t)
      .forEach((r, k) => {
        if (r.quality === null) {
          missing.push(
            `${t} ${r.arm}${r.repeat && r.repeat > 1 ? ` r${r.repeat}` : ''}`,
          );
          return;
        }
        const color = ARM_COLORS[String(r.arm)] ?? '#111827';
        body += `<circle cx="${x(r.quality)}" cy="${y + (k % 3) * 4 - 4}" r="5" fill="${color}"><title>${esc(`${t} ${r.arm} quality ${r.quality}`)}</title></circle>\n`;
      });
  });
  Object.entries(ARM_COLORS).forEach(([arm, color], i) => {
    body += `<circle cx="${w - right + 20}" cy="${i * 16 + 10}" r="5" fill="${color}"/><text x="${w - right + 30}" y="${i * 16 + 14}">${arm}</text>\n`;
  });
  body += `<text x="${left}" y="${h - 8}" fill="#374151">Mean reviewer quality (1-5). Not rated: ${esc(missing.join(', ') || 'none')}.</text>\n`;
  return svg('Decision quality by task and arm', a.label, w, h, body);
}

/** Task-level paired differences for each contrast; excluded pairs are counted, not drawn. */
function pairedFigure(a: Analysis) {
  const contrasts = [
    ...a.prespecified.paired_comparisons.map((p) => ({
      name: `${p.stratum}: ${p.contrast}`,
      diffs: p.rows
        .map((r) => r.difference)
        .filter((d): d is number => d !== null),
      excluded: p.rows.filter((r) => r.difference === null).length,
      scale: p.stratum === 'decision' ? 4 : 1,
    })),
    {
      name: `discovery: ${a.prespecified.discovery_comparison.contrast.split(' (')[0]}`,
      diffs: a.prespecified.discovery_comparison.rows
        .map((r) => r.difference_open_minus_structured)
        .filter((d): d is number => d !== null),
      excluded: a.prespecified.discovery_comparison.rows.filter(
        (r) => r.difference_open_minus_structured === null,
      ).length,
      scale: 4,
    },
  ];
  const w = 640;
  const left = 230;
  const right = 120;
  const rowH = 30;
  const h = contrasts.length * rowH + 56;
  const mid = left + (w - left - right) / 2;
  const half = (w - left - right) / 2;
  let body = `<line x1="${mid}" y1="0" x2="${mid}" y2="${h - 30}" stroke="#6b7280" stroke-dasharray="4 3"/>\n`;
  contrasts.forEach((c, i) => {
    const y = i * rowH + 16;
    body += `<text x="8" y="${y + 4}">${esc(c.name)}</text>\n`;
    for (const d of c.diffs)
      body += `<circle cx="${mid + (d / c.scale) * half}" cy="${y}" r="4" fill="#1f2937" fill-opacity="0.7"><title>${d}</title></circle>\n`;
    body += `<text x="${w - right + 8}" y="${y + 4}" fill="#374151">n=${c.diffs.length}, excluded ${c.excluded}</text>\n`;
  });
  body += `<text x="8" y="${h - 24}" fill="#374151">Each dot is one task; the dashed line is zero. Decision rows span -4 to 4, implementation -1 to 1.</text>\n`;
  body += `<text x="8" y="${h - 8}" fill="#374151">Excluded pairs are counted, not drawn. No interval is drawn below the plan minimum.</text>\n`;
  return svg('Task-level paired differences', a.label, w, h, body);
}

/** Known spend and unknown or in-flight exposure per group, in USD. */
function resourcesFigure(a: Analysis) {
  const rows = a.prespecified.resources;
  const w = 640;
  const left = 230;
  const right = 120;
  const rowH = 26;
  const h = Math.max(1, rows.length) * rowH + 40;
  const val = (r: (typeof rows)[number]) => ({
    known: Number(r.known_spend_usd),
    exposure: Number(r.unknown_exposure_usd) + Number(r.in_flight_exposure_usd),
  });
  const max = Math.max(
    1e-9,
    ...rows.map((r) => val(r).known + val(r).exposure),
  );
  const scale = (v: number) => (v / max) * (w - left - right);
  let body = '';
  rows.forEach((r, i) => {
    const y = i * rowH + 6;
    const v = val(r);
    body += `<text x="8" y="${y + 13}">${esc(`${r.comparison} ${r.stratum} ${r.arm}`)}</text>\n`;
    body += `<rect x="${left}" y="${y}" width="${scale(v.known)}" height="16" fill="#2563eb"/>\n`;
    if (v.exposure)
      body += `<rect x="${left + scale(v.known)}" y="${y}" width="${scale(v.exposure)}" height="16" fill="none" stroke="#dc2626" stroke-dasharray="3 2"/>\n`;
    body += `<text x="${w - right + 8}" y="${y + 13}" fill="#374151">$${r.known_spend_usd}${v.exposure ? '+' : ''}</text>\n`;
  });
  body += `<text x="8" y="${h - 8}" fill="#374151">Solid: known spend. Dashed (and +): unknown or in-flight exposure, so the total is a lower bound.</text>\n`;
  return svg(
    'Spend by comparison, stratum and arm (every attempt)',
    a.label,
    w,
    h,
    body,
  );
}

export function renderAnalysis(a: Analysis) {
  const p = a.prespecified;
  const sections: [string, string, Row[], string][] = [
    [
      'completion',
      'Completion by assigned condition',
      p.completion,
      'flow (evaluation-package.json)',
    ],
    [
      'decision-quality',
      'Decision quality per reviewed slot',
      p.decision_quality,
      'reviewers/*/ratings.csv via private/assignment-key.json',
    ],
    [
      'functional-completion',
      'Functional completion (implementation stratum)',
      p.functional_completion,
      'functional_checks (evaluation-package.json)',
    ],
    [
      'paired-comparisons',
      'Task-level paired comparisons',
      p.paired_comparisons.flatMap((c) =>
        c.rows.map((r) => ({ stratum: c.stratum, contrast: c.contrast, ...r })),
      ),
      'decision-quality and functional-completion tables',
    ],
    [
      'paired-summaries',
      'Paired comparison summaries',
      p.paired_comparisons.map(({ rows: _, ...c }) => c),
      'paired-comparisons table',
    ],
    [
      'discovery-comparison',
      'Discovery comparison per theme',
      p.discovery_comparison.rows,
      'decision-quality table',
    ],
    [
      'resources',
      'Resources and cost per accepted outcome',
      p.resources,
      'attempt measurements (flow, reconciled with private/raw-exports)',
    ],
    [
      'human-effort-latency',
      'Human effort and latency',
      p.human_effort_and_latency,
      'attempt measurements',
    ],
    [
      'interventions',
      'Interventions (assisted arm)',
      p.interventions,
      'raw_events kind interventions (private/raw-exports)',
    ],
    [
      'evidence-validity',
      'Evidence validity (source support audits)',
      p.evidence_validity,
      'source_support_audits (evaluation-package.json)',
    ],
    [
      'reviewer-agreement',
      'Reviewer agreement',
      p.reviewer_agreement.dimensions,
      'reviewers/*/ratings.csv',
    ],
    [
      'reviewer-disagreements',
      'Reviewer disagreements of two points or more',
      p.reviewer_agreement.disagreements,
      'reviewers/*/ratings.csv',
    ],
    [
      'deviations',
      'Deviations and slots that did not run',
      a.deviations,
      'raw_events kind deviations; flow reasons',
    ],
    [
      'per-protocol-completion',
      'EXPLORATORY: per-protocol completion',
      a.exploratory.per_protocol_completion,
      'flow',
    ],
  ];
  const files: Record<string, string> = {};
  let md =
    `# Creator Agent analysis\n\n> **${a.label}**\n\n` +
    `Data kind: \`${a.data_kind}\`. Empirical: ${a.empirical ? 'yes' : 'no'}. ` +
    `Analysis hash \`${a.analysis_hash}\`. Plan \`${a.plan.version}\` (${a.plan.status})\n\n` +
    `## Inputs (raw-data references)\n\n` +
    a.inputs.files
      .map((f) => `- \`${f.path}\` sha256 \`${f.sha256}\``)
      .join('\n') +
    `\n\nPackage \`${a.inputs.package_hash}\`, schedule \`${a.inputs.schedule_hash}\`, freeze origin \`${a.inputs.freeze.origin}\`.\n\n` +
    `## Totals\n\n${table(a.label, [a.totals as unknown as Row]).md}\n\n` +
    `## Prespecified tables\n\n`;
  for (const [name, title, rows, source] of sections) {
    const t = table(a.label, rows);
    files[`tables/${name}.csv`] = t.csv;
    if (name === 'per-protocol-completion') continue;
    md += `### ${title}\n\nSource: ${source}. CSV: \`tables/${name}.csv\`.\n\n${t.md}\n\n`;
  }
  const exploratory = sections.at(-1)!;
  md +=
    `## Exploratory (not prespecified)\n\n### ${exploratory[1]}\n\nSource: ${exploratory[3]}. CSV: \`tables/${exploratory[0]}.csv\`.\n\n${table(a.label, exploratory[2]).md}\n\n` +
    `## Not measured\n\n- Potential benefit: ${a.not_measured.potential_benefit}.\n- Observed user impact: ${a.not_measured.observed_user_impact}.\n\n` +
    `## Gaps\n\n${a.gaps.map((g) => `- ${g}`).join('\n')}\n\n` +
    `## Limitations\n\n${a.limitations.map((g) => `- ${g}`).join('\n')}\n\n` +
    `## Reconciliation checks\n\n${a.reconciliation.map((c) => `- ${c.status.toUpperCase()} \`${c.id}\`: ${c.detail}`).join('\n')}\n\n` +
    `## Figures\n\n- figures/decision-quality.svg\n- figures/paired-differences.svg\n- figures/resources.svg\n\n> **${a.label}**\n`;
  files['report.md'] = md;
  files['figures/decision-quality.svg'] = qualityFigure(a);
  files['figures/paired-differences.svg'] = pairedFigure(a);
  files['figures/resources.svg'] = resourcesFigure(a);
  files['analysis.json'] = `${JSON.stringify(a, null, 2)}\n`;
  return files;
}
