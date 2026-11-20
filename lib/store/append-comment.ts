import { tx } from '../db';
import { same, noteVersion, SYSTEM_AUTHORS } from './create-project';

// ---------------------------------------------------------------- permission check for a patch
export function ticketNeeds(old, nw, user) {
  if (!old) return [['issue.create']];
  const needs: any[] = [];
  const keys = new Set([...Object.keys(old), ...Object.keys(nw)]);
  for (const k of keys) {
    if (k === 'history' || k === 'updatedAt' || same(old[k], nw[k])) continue;
    if (k === 'comments') {
      const before = new Map((old.comments || []).map((c) => [c.id, c]));
      const after = new Map((nw.comments || []).map((c: any) => [c.id, c]));
      for (const [cid, c] of after) {
        const prev: any = before.get(cid);
        if (!prev) needs.push(['issue.comment']);
        else if (!same(prev, c))
          needs.push(prev.authorId === user.id ? ['issue.comment'] : ['issue.edit']);
      }
      for (const [cid, c] of before as Map<any, any>)
        if (!after.has(cid))
          needs.push(c.authorId === user.id ? ['issue.comment'] : ['issue.edit']);
      continue;
    }
    if (k === 'testCases') {
      const before = new Map((old.testCases || []).map((c) => [c.id, c]));
      const after = nw.testCases || [];
      const structural =
        after.length !== before.size ||
        after.some((c) => !before.has(c.id)) ||
        after.some((c) => {
          const p: any = before.get(c.id);
          const { status: _a, lastRun: _b, script: _c, ...x } = c as any;
          const { status: _d, lastRun: _e, script: _f, ...y } = p;
          return !same(x, y);
        });
      needs.push(structural ? ['issue.edit'] : ['test.run', 'issue.edit']);
      continue;
    }
    if (k === 'sprintId' || k === 'fixVersions') needs.push(['sprint.manage', 'issue.edit']);
    else if (k === 'epicId') needs.push(['epic.manage', 'issue.edit']);
    else if (k === 'status' || k === 'assignee' || k === 'reporter')
      needs.push(['issue.edit', 'project.settings']);
    else if (k === 'links') needs.push(['issue.edit', 'issue.delete']);
    else needs.push(['issue.edit']);
  }
  return needs;
}
/**
 * Automated comments are added on the server (e.g. after a failed test run). A client that loaded
 * the issue earlier doesn't know about them yet, so they are carried over instead of being dropped
 * by its save.
 */
export function keepSystemEntries(old, tk) {
  if (!old) return tk;
  const have = new Set((tk.comments || []).map((c) => c.id));
  const keep = (old.comments || []).filter((c) => c.system && !have.has(c.id));
  if (!keep.length) return tk;
  return {
    ...tk,
    comments: [...(tk.comments || []), ...keep].sort((a, b) =>
      String(a.at).localeCompare(String(b.at)),
    ),
  };
}
/**
 * Appends an automated comment to an issue (server-side) and bumps the project version so clients
 * sync.
 */
export async function appendComment(projectId, issueId, comment) {
  const NONE = Symbol('no issue');
  try {
    const v = await tx(async (t) => {
      // The project row first (the same order as saves, so the two never wait on each other).
      const pr = (
        await t.query(
          'update projects set version = version + 1, updated_at = now() where id = $1 returning version',
          [projectId],
        )
      ).rows[0];
      const row =
        pr &&
        (
          await t.query('select data from issues where project_id = $1 and id = $2', [
            projectId,
            issueId,
          ])
        ).rows[0];
      if (!row) throw NONE; // rolls the version back
      const d = row.data;
      d.comments = [...(d.comments || []), comment];
      d.updatedAt = new Date().toISOString();
      await t.query(
        'update issues set data = $3, rev = $4, updated_at = now() where project_id = $1 and id = $2',
        [projectId, issueId, JSON.stringify(d), pr.version],
      );
      return pr.version;
    });
    noteVersion(projectId, v);
    return true;
  } catch (e) {
    if (e === NONE) return false;
    throw e;
  }
}
/** Fill in trusted authorship on new comments and history entries. */
export function stamp(old, nw, user) {
  const oldComments = new Map((old?.comments || []).map((c) => [c.id, c]));
  nw.comments = (nw.comments || []).map((c) => {
    const prev: any = oldComments.get(c.id);
    if (prev?.system) return prev; // automated comments stay exactly as the server wrote them
    if (prev) return { ...c, authorId: prev.authorId, author: prev.author, system: prev.system };
    const { system: _s, failures: _f, results: _r, ...rest } = c; // only the server can create automated comments
    return { ...rest, authorId: user.id, author: user.name };
  });
  const oldHist = new Set((old?.history || []).map((h) => h.id));
  nw.history = (nw.history || []).map((h) =>
    oldHist.has(h.id) || SYSTEM_AUTHORS.has(h.author) ? h : { ...h, author: user.name },
  );
  return nw;
}
