import { useMemo, useState } from 'react';
import { bytesText, zipEntries } from '@creator/contracts';

// ADR-0106: a ZIP archive's table of contents, read from its central directory. Nothing is
// unpacked, so no file inside it is opened or run, and a ZIP bomb costs nothing to list.

const SHOWN = 500;

export function ArchiveView({ bytes }: { bytes: ArrayBuffer }) {
  const zip = useMemo(() => zipEntries(new Uint8Array(bytes)), [bytes]);
  const [all, setAll] = useState(false);
  if (!zip)
    return (
      <p className="notice">
        The studio could not read this archive’s list of files. Download the
        original to open it.
      </p>
    );
  const files = zip.entries.filter((e) => !e.dir);
  const total = files.reduce((n, e) => n + (e.size ?? 0), 0);
  // A size stored as ZIP64 is not read, so the total is then a lower bound.
  const unknown = files.some((e) => e.size === null);
  const shown = all ? files : files.slice(0, SHOWN);
  return (
    <div className="archive-view">
      <p className="small">
        {files.length.toLocaleString('en-US')} file
        {files.length === 1 ? '' : 's'}, {unknown ? 'at least ' : ''}
        {bytesText(total)} unpacked
        {zip.more
          ? ` (the first ${zip.entries.length.toLocaleString('en-US')} entries are listed)`
          : ''}
        . Nothing inside is opened; download the original to unpack it.
      </p>
      {files.length > 0 && (
        <div className="file-table">
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col" className="num">
                  Size
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e, i) => (
                <tr key={`${i}-${e.name}`}>
                  <td className="archive-name">{e.name}</td>
                  <td className="num">
                    {e.size === null ? 'Large' : bytesText(e.size)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!all && files.length > SHOWN && (
        <button
          type="button"
          className="secondary"
          onClick={() => setAll(true)}
        >
          Show all {files.length.toLocaleString('en-US')} files
        </button>
      )}
    </div>
  );
}
