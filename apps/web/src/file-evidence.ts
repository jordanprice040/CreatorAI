import {
  FileSourceResultSchema,
  type FileSourceResult,
} from '@creator/contracts';
import { api } from './oversight.js';

/**
 * ADR-0134: makes the current version of an uploaded file a source on the Evidence page, so
 * its passages can be cited in claims. The server reads the file's own kept text; nothing is
 * fetched and nothing is sent to a model now. Quotes later cited in a claim travel with that
 * claim to model steps such as Decide, under those steps' own data-class rules.
 */
export function fileAsEvidence(
  workspaceId: string,
  csrf: string,
  fileId: string,
  fileVersion: number,
): Promise<FileSourceResult> {
  return api(FileSourceResultSchema, `workspaces/${workspaceId}/sources`, {
    csrf,
    body: { file_id: fileId, file_version: fileVersion },
  });
}

/** One line on what using the file as evidence did. */
export function fileEvidenceNote(r: FileSourceResult): string {
  const n = `${r.passages} passage${r.passages === 1 ? '' : 's'}`;
  return `${r.changed ? 'Ready to cite' : 'Already a source; nothing changed'}: ${n}${
    r.partial
      ? '. Only the start of this document can be cited: it is longer than one source keeps.'
      : '.'
  }`;
}
