import { useMemo, useState } from 'react';
import { read, utils, type WorkBook } from 'xlsx';
import { SHEET_MAX_COLS, SHEET_MAX_ROWS } from './file-viewer-rules.js';

// ADR-0106: spreadsheets (.xlsx, .xlsm, .xls) read by SheetJS Community Edition (Apache-2.0)
// into plain cell text, shown as a React table with sheet tabs. Values are the formatted text
// Excel would show; formulas are not recalculated and macros never run. Nothing is HTML.

type Sheet = {
  name: string;
  rows: string[][];
  totalRows: number;
  totalCols: number;
  /** Where the used range starts, so row and column labels match Excel's. */
  r0: number;
  c0: number;
};

const column = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

export function readSheets(bytes: ArrayBuffer): Sheet[] {
  const wb: WorkBook = read(new Uint8Array(bytes), {
    type: 'array',
    sheetRows: SHEET_MAX_ROWS,
    cellFormula: true,
    sheetStubs: true,
    cellHTML: false,
    cellStyles: false,
    bookVBA: false,
    WTF: false,
  });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref'])
      return { name, rows: [], totalRows: 0, totalCols: 0, r0: 0, c0: 0 };
    // A formula saved without its value (written by a program, never opened in Excel) shows
    // as its formula text rather than as an empty cell.
    for (const [k, c] of Object.entries(ws))
      if (
        !k.startsWith('!') &&
        c &&
        typeof c === 'object' &&
        'f' in c &&
        (c.v === undefined || c.t === 'z')
      ) {
        c.t = 's';
        c.v = c.w = `=${String(c.f)}`;
      }
    const ref = utils.decode_range(ws['!ref']);
    const full = utils.decode_range(ws['!fullref'] ?? ws['!ref']);
    const rows = utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: true,
    });
    const cols = Math.min(
      SHEET_MAX_COLS,
      rows.reduce((m, r) => Math.max(m, r.length), 0),
    );
    return {
      name,
      rows: rows.map((r) =>
        Array.from({ length: cols }, (_, i) => String(r[i] ?? '')),
      ),
      totalRows: full.e.r - full.s.r + 1,
      totalCols: full.e.c - full.s.c + 1,
      r0: ref.s.r,
      c0: ref.s.c,
    };
  });
}

export function SheetView({ bytes }: { bytes: ArrayBuffer }) {
  const result = useMemo(() => {
    try {
      return { sheets: readSheets(bytes), error: '' };
    } catch (e) {
      const text = e instanceof Error ? e.message : '';
      return {
        sheets: [] as Sheet[],
        error: /password|encrypt/i.test(text)
          ? 'This spreadsheet is password-protected. Download the original to open it.'
          : 'The studio could not read this spreadsheet. It may be damaged; download the original to open it.',
      };
    }
  }, [bytes]);
  const [tab, setTab] = useState(0);
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
