import { useState } from 'react';
import {
  RunbookSummarySchema,
  WorkspaceFileSchema,
  z,
  type RunbookSummary,
  type SessionInfo,
} from '@creator/contracts';
import { api, message } from './oversight.js';

// ADR-0080 (P16): hand a spec or a proposal to another coding model or person as a runbook:
// a ZIP of plain files with ordered prompts, checks and recovery steps that reads without the
// studio. Downloading or saving it changes nothing in the studio.

const size = (n: number) =>
  n < 1024 ? `${n} bytes` : `${Math.round(n / 1024)} KB`;

/** What the bundle holds, in one sentence. */
export function runbookSummaryText(s: RunbookSummary): string {
  const m = s.manifest;
  const held = m.withheld.held_out_cases;
  return [
    `${m.prompts.length} ordered prompts and ${m.files.length + 1} files (${size(s.archive_bytes)})`,
    m.kind === 'software'
      ? m.freeze
        ? 'from the frozen requirements'
        : 'from requirements that are not frozen'
      : 'for a plan people carry out, not a software build',
    ...(held
      ? [
          `${held} held-out test case${held === 1 ? '' : 's'} left out for you to run`,
        ]
      : []),
  ].join(', ');
}

export function RunbookExport({
  base,
  session,
  subject,
  id,
  version,
  writer,
}: {
  base: string;
  session: SessionInfo;
  /** A spec gives a software runbook; a proposal gives an action runbook. */
  subject: 'specs' | 'proposals';
  id: string;
  version: number;
  writer: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<RunbookSummary | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const path = `${base}/${subject}/${id}/runbook`;
  async function show() {
    setOpen(true);
    setNote('');
    setError('');
    setSummary(null);
    try {
      setSummary(await api(RunbookSummarySchema, `${path}?version=${version}`));
    } catch (err) {
      setError(message(err));
    }
  }
  async function toFiles() {
    setNote('');
    setError('');
    setBusy(true);
    try {
      const out = await api(
        z.object({ file: WorkspaceFileSchema, stored: z.boolean() }).loose(),
        path,
        {
          csrf: session.csrf_token,
          body: { version, upload_key: crypto.randomUUID() },
        },
      );
      setNote(
        out.stored
          ? `Saved to Files as ${out.file.name}.`
          : `Files already has this runbook (${out.file.name}).`,
      );
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  if (!open)
    return (
      <button className="text" type="button" onClick={() => void show()}>
        Export a runbook for another model
      </button>
    );
  return (
    <div className="runbook-export small" role="group" aria-label="Runbook">
      <p>
        <strong>Runbook of v{version}.</strong> A ZIP of plain files another
        coding model or a person can follow without this studio:{' '}
        {subject === 'specs'
          ? 'the requirements, checks, task order and one prompt per step.'
          : 'the plan, its evidence and one prompt per step.'}
      </p>
      {!summary && !error && <p role="status">Preparing the runbook…</p>}
      {summary && (
        <>
          <p>{runbookSummaryText(summary)}.</p>
          {summary.manifest.warnings.length > 0 && (
            <ul>
              {summary.manifest.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <div className="actions">
            <a
              className="button secondary"
              href={`/api/${path}?format=zip&version=${version}`}
              download
            >
              Download {summary.name}
            </a>
            {writer && (
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => void toFiles()}
              >
                Save to Files
              </button>
            )}
            <button
              className="text"
              type="button"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
        </>
      )}
      {note && <p role="status">{note}</p>}
      {error && (
        <p className="error" role="alert">
          {error}{' '}
          <button className="text" type="button" onClick={() => setOpen(false)}>
            Close
          </button>
        </p>
      )}
    </div>
  );
}
