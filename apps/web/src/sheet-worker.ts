/// <reference lib="webworker" />
import { readSheets } from './sheet-read.js';

// Review L-2: a workbook is read off the page's thread, so a large file never freezes the
// studio; the page can stop the worker when the file is closed.
self.onmessage = (e: MessageEvent<ArrayBuffer>) => {
  try {
    self.postMessage({ sheets: readSheets(e.data) });
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : '' });
  }
};
