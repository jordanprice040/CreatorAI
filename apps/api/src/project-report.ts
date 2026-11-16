import type { ServerResponse } from 'node:http';
import { ContractError } from '@creator/contracts';
import type { CommandContext, ProjectReportStore } from '@creator/db';
import { INERT, disposition } from './files.js';

// ADR-0117 (F3): the project report. GET downloads one Markdown file built from the
// workspace's records; any member who can read the workspace may download it. Nothing is
// stored, no model is called and nothing is audited as a change, because nothing changes.

export const PROJECT_REPORT_ROUTE =
  /^\/api\/workspaces\/([^/]+)\/(project-report)$/;

export async function projectReportRoutes(r: {
  store: ProjectReportStore;
  ctx: CommandContext;
  ws: string;
  method: string;
  res: ServerResponse;
}): Promise<boolean> {
  if (r.method !== 'GET')
    throw new ContractError('NOT_FOUND', 'Unknown project report route.');
  const out = await r.store.projectReport(r.ctx, r.ws);
  const bytes = Buffer.from(out.markdown, 'utf8');
  r.res.writeHead(200, {
    ...INERT,
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Length': String(bytes.length),
    'Content-Disposition': disposition('attachment', out.name),
  });
  r.res.end(bytes);
  return true;
}
