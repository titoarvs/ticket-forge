import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import * as store from '@/lib/store.js';
import { toCsvTickets, toCsvTestCases, toCsvJira, toXlsx, toDocx, toPdf, toHtml, slug } from '@/lib/exporters.js';
import { assignKeys } from '@/lib/model.js';

const EXPORTS: Record<string, { ext: string; type: string; fn: (p: any) => any }> = {
  csv: { ext: 'tickets.csv', type: 'text/csv; charset=utf-8', fn: toCsvTickets },
  'csv-tests': { ext: 'test-cases.csv', type: 'text/csv; charset=utf-8', fn: toCsvTestCases },
  'csv-jira': { ext: 'jira-import.csv', type: 'text/csv; charset=utf-8', fn: toCsvJira },
  xlsx: { ext: 'xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fn: toXlsx },
  docx: { ext: 'docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fn: toDocx },
  pdf: { ext: 'pdf', type: 'application/pdf', fn: toPdf },
  html: { ext: 'html', type: 'text/html; charset=utf-8', fn: toHtml },
  json: { ext: 'json', type: 'application/json', fn: (p) => JSON.stringify(p, null, 2) },
};

export const POST = api(async (req, p) => {
  const user = await perm('export');
  const ex = EXPORTS[p.format];
  if (!ex) throw new HttpError(400, 'Unknown export format');
  const b = await body(req);
  if (b?.id) await store.requireProject(user, b.id);
  const project = assignKeys(b);
  const out = await ex.fn(project);
  return new Response(out, { headers: { 'Content-Type': ex.type, 'Content-Disposition': `attachment; filename="${slug(project.name)}.${ex.ext}"` } });
});
