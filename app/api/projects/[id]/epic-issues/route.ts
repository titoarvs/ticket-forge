import { api, perm, body, HttpError, aiOpts, ndjson } from '@/lib/server/http';
import * as store from '@/lib/store';
import { generateEpicIssues } from '@/lib/epic-issues';
import { approvalCheck } from '@/lib/approval';
import { withDraftEpic } from '@/lib/feature-docs';

// Writing the issues of an epic takes a minute or two.
export const maxDuration = 300;

/** The approval state of an epic's three documents: { ok, docs: [{ kind, label, state, version, approvedBy, approvedAt }] }. */
export const GET = api(async (req, p) => {
  store.requireAccess(await perm('issue.create'), p.id);
  const epicId = new URL(req.url).searchParams.get('epicId') || '';
  const project = await store.getProject(p.id);
  const epic = project.epics.find((e: any) => e.id === epicId);
  if (!epic) throw new HttpError(404, 'That epic isn’t in this project.');
  return approvalCheck(epic);
});

/**
 * Writes issues (with test cases) for an epic from its approved Problem Statement, Feature Brief and Architecture
 * Record Design. Refused (409) until all three are approved. Nothing is saved: the app shows the result for review.
 */
export const POST = api(async (req, p) => {
  const user = await perm('ai.use', 'issue.create');
  store.requireAccess(user, p.id);
  const b = await body(req);
  let project = await store.getProject(p.id);
  let epic = project.epics.find((e: any) => e.id === b.epicId);
  // Add feature: an epic still being planned, with the documents approved in the brainstorm (not saved on the project yet).
  const d = b.draftEpic;
  if (d && d.id === b.epicId && /^[\w-]{1,64}$/.test(String(d.id)) && String(d.title || '').trim()) {
    epic = { id: String(d.id), title: String(d.title).slice(0, 200), description: String(d.description || '').slice(0, 2000), psd: d.psd, fbd: d.fbd, ard: d.ard };
    project = withDraftEpic(project, epic);
  }
  if (!epic) throw new HttpError(404, 'That epic isn’t in this project (save first if you just created it).');
  const c = approvalCheck(epic);
  if (!c.ok) { const e: any = new HttpError(409, `Issues are written from approved documents. Still to approve for “${epic.title}”: ${c.blocking}.`); e.extra = { code: 'docs-not-approved', docs: c.docs }; throw e; }
  return ndjson(req, async (send, signal) => {
    const result = await generateEpicIssues({ project, epicId: String(b.epicId), instructions: String(b.instructions || ''), options: { granularity: b.granularity, includeTests: b.includeTests, testsPerTicket: b.testsPerTicket }, ai: aiOpts(b), signal, emit: (e: any) => send({ type: 'progress', ...e }) });
    send({ type: 'done', result });
  });
});
