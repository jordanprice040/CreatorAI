import { useRef, useState } from 'react';
import { SupportReportSchema, type SupportReport } from '@creator/contracts';
import { api, message } from './oversight.js';
import './support-report.css';

/**
 * ADR-0118 (F5): prepares the owner's support report, shows exactly what will be copied, and
 * copies it only when the person presses Copy. Nothing is sent anywhere by the studio.
 */
export function SupportReportPanel() {
  const [report, setReport] = useState<SupportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);

  async function prepare() {
    setBusy(true);
    setError('');
    setNote('');
    try {
      setReport(await api(SupportReportSchema, 'support/report'));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!report) return;
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(report.text);
      setNote('Copied. Paste it wherever you are asking for help.');
    } catch {
      box.current?.focus();
      box.current?.select();
      setNote('Copying is blocked here. The text is selected: press Ctrl+C.');
    }
  }

  return (
    <div className="support-report">
      <h3>Support report</h3>
      <p className="small">
        App version, commit, schema, system, worker and connection health, and
        the last 20 errors or failed steps with their ids. Keys, tokens,
        cookies, passwords, emails, personal folders and account names are
        hidden. You see the full text before anything is copied, and nothing is
        sent anywhere.
      </p>
      <div className="support-report-actions">
        <button
          type="button"
          className="secondary"
          onClick={() => void prepare()}
          disabled={busy}
        >
          {busy
            ? 'Preparing…'
            : report
              ? 'Prepare again'
              : 'Prepare support report'}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {report && (
        <>
          <label htmlFor="support-report-text" className="small">
            Preview of the text that will be copied ({report.hidden}{' '}
            {report.hidden === 1 ? 'item' : 'items'} hidden)
          </label>
          <textarea
            id="support-report-text"
            ref={box}
            readOnly
            value={report.text}
            spellCheck={false}
            wrap="off"
          />
          <div className="support-report-actions">
            <button type="button" onClick={() => void copy()}>
              Copy report
            </button>
            <span className="small" role="status" aria-live="polite">
              {note}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
