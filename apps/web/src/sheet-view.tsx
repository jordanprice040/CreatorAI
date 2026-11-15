import { useEffect, useState } from 'react';
import { SHEET_MAX_COLS, SHEET_MAX_ROWS } from './file-viewer-rules.js';
import { column, type Sheet } from './sheet-read.js';

// ADR-0106: a spreadsheet shown as a React table with sheet tabs. The workbook is read in a
// worker (sheet-worker.ts, review L-2), so the page keeps responding while a large file is read.

function failure(text: string): string {
  return /password|encrypt/i.test(text)
    ? 'This spreadsheet is password-protected. Download the original to open it.'
    : 'The studio could not read this spreadsheet. It may be damaged; download the original to open it.';
}

export function SheetView({
  bytes,
  transfer = false,
  onSpent,
}: {
  bytes: ArrayBuffer;
  /**
   * Review 7 N-1: hand `bytes` itself to the worker (the page then no longer holds them), for a
   * re-packed copy made only for this view. `onSpent` asks for a fresh copy if the view is
   * shown again after its bytes were handed over.
   */
  transfer?: boolean;
  onSpent?: () => void;
}) {
  const [result, setResult] = useState<{
    sheets: Sheet[];
    error: string;
  } | null>(null);
  useEffect(() => {
    setResult(null);
    if (transfer && bytes.byteLength === 0) {
      onSpent?.();
      return;
    }
    const worker = new Worker(new URL('./sheet-worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (
      e: MessageEvent<{ sheets?: Sheet[]; error?: string }>,
    ) => {
      setResult(
        e.data.sheets
          ? { sheets: e.data.sheets, error: '' }
          : { sheets: [], error: failure(e.data.error ?? '') },
      );
      worker.terminate();
    };
    worker.onerror = () => {
      setResult({ sheets: [], error: failure('') });
      worker.terminate();
    };
    // Transferred, not cloned; a copy unless these bytes were made for this view alone.
    const sent = transfer ? bytes : bytes.slice(0);
    worker.postMessage(sent, [sent]);
    return () => worker.terminate();
    // onSpent is a request back to the parent, not an input to reading the bytes.
  }, [bytes, transfer]);
  const [tab, setTab] = useState(0);
  if (!result) return <p className="small">Reading the spreadsheet…</p>;
  if (result.error) return <p className="notice">{result.error}</p>;
  if (!result.sheets.length)
    return <p className="small">This workbook has no sheets.</p>;
  const sheet = result.sheets[Math.min(tab, result.sheets.length - 1)]!;
  const cut =
    sheet.totalRows > sheet.rows.length || sheet.totalCols > SHEET_MAX_COLS;
  return (
    <div className="sheet-view">
      {result.sheets.length > 1 && (
        <div className="sheet-tabs" role="tablist" aria-label="Sheets">
          {result.sheets.map((s, i) => (
            <button
              key={`${i}-${s.name}`}
              type="button"
              role="tab"
              aria-selected={i === tab}
              className="sheet-tab"
              onClick={() => setTab(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      {sheet.rows.length === 0 ? (
        <p className="small">This sheet is empty.</p>
      ) : (
        <div className="file-table sheet-grid" tabIndex={0}>
          <table aria-label={`Sheet ${sheet.name}`}>
            <thead>
              <tr>
                <th scope="col" className="sheet-corner">
                  <span className="sr-only">Row</span>
                </th>
                {sheet.rows[0]!.map((_, i) => (
                  <th key={i} scope="col">
                    {column(i + sheet.c0)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((r, i) => (
                <tr key={i}>
                  <th scope="row">{i + 1 + sheet.r0}</th>
                  {r.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small">
        {cut
          ? `Showing the first ${Math.min(sheet.rows.length, SHEET_MAX_ROWS).toLocaleString('en-US')} rows and ${Math.min(sheet.totalCols, SHEET_MAX_COLS)} columns of ${sheet.totalRows.toLocaleString('en-US')} × ${sheet.totalCols}; download for the rest. `
          : ''}
        Values as Excel last saved them; formulas are not recalculated (a
        formula saved without a value shows as its formula) and macros never
        run.
      </p>
    </div>
  );
}
