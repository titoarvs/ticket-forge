import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { tx, q, DATA_DIR } from '../db';
import { HttpError } from '../auth';
import { specConfig, findOverlaps, specPrompt, describeOverlap } from '../specs';
import { requirePerm, noteVersion, getProject, createProject } from './create-project';
import { versionFields, insertVersions } from './patch-project';

/**
 * Sets an issue's fields back to one of its versions and records the restore as a new version.
 * Comments and the change history stay (a "restored version N" entry is added). Admins and managers
 * only (issue.restore).
 * Returns { version, number }: the new project version and the new issue version number.
 */
export async function restoreVersion(projectId, issueId, number, user) {
  requirePerm(user, 'issue.restore');
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'Choose a version to restore.');
  const out = await tx(async (t) => {
    const pr = (
      await t.query(
        'update projects set version = version + 1, updated_at = now() where id = $1 returning version',
        [projectId],
      )
    ).rows[0];
    if (!pr) throw new HttpError(404, 'Project not found');
    const cur = (
      await t.query('select data from issues where project_id = $1 and id = $2', [
        projectId,
        issueId,
      ])
    ).rows[0];
    if (!cur) throw new HttpError(404, 'Issue not found');
    const ver = (
      await t.query(
        'select data from issue_versions where project_id = $1 and issue_id = $2 and number = $3',
        [projectId, issueId, n],
      )
    ).rows[0];
    if (!ver) throw new HttpError(404, `Version ${n} of this issue was not found.`);
    const now = new Date().toISOString();
    const old = cur.data;
    const data = {
      ...versionFields(ver.data),
      id: old.id,
      createdAt: old.createdAt ?? ver.data.createdAt,
      updatedAt: now,
      comments: old.comments || [],
      history: [
        ...(old.history || []),
        {
          id: `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          at: now,
          author: user.name || '',
          field: 'event',
          text: `restored version ${n}`,
        },
      ],
    };
    await t.query(
      'update issues set data = $3, rev = $4, updated_by = $5, updated_at = now() where project_id = $1 and id = $2',
      [projectId, issueId, JSON.stringify(data), pr.version, user.id],
    );
    await insertVersions(t, projectId, [{ id: issueId, data }], user, n);
    const next = (
      await t.query(
        'select max(number)::int as m from issue_versions where project_id = $1 and issue_id = $2',
        [projectId, issueId],
      )
    ).rows[0].m;
    return { version: pr.version, number: next };
  });
  noteVersion(projectId, out.version);
  return out;
}
// ---------------------------------------------------------------- coding specs
const specOut = (r) => ({
  ticketId: r.ticket_id,
  key: r.ticket_key,
  title: r.title,
  epicId: r.epic_id,
  status: r.status,
  prompt: r.prompt,
  criteria: r.criteria || [],
  files: r.files || [],
  modules: r.modules || [],
  generatedBy: r.generated_by,
  generatedAt: r.generated_at,
  readyBy: r.ready_by,
  readyAt: r.ready_at,
});
const changeOut = (r) => ({
  id: r.id,
  ticketId: r.ticket_id,
  ref: r.ref,
  summary: r.summary,
  status: r.status,
  approvals: r.approvals || [],
  createdBy: r.created_by,
  createdAt: r.created_at,
  acceptedBy: r.accepted_by,
  acceptedAt: r.accepted_at,
});
/** The project's coding spec settings: { overlapMode: 'block' | 'warn', reviewers: [userId] }. */
async function projectSpecConfig(projectId) {
  const r = (
    await q('select data from projects where id = $1 and archived_at is null', [projectId])
  ).rows[0];
  if (!r) throw new HttpError(404, 'Project not found');
  return specConfig(r.data);
}
/**
 * The project's coding specs (of one epic when epicId is given) with their linked changes, and the
 * overlaps between specs (lib/specs.ts) that involve them: { specs, overlaps, config }. Overlaps
 * are worked out on every read, so they follow the specs' current files and which specs are ready.
 */
export async function listSpecs(projectId, epicId = '') {
  const [rows, changes, config] = await Promise.all([
    q('select * from coding_specs where project_id = $1 order by ticket_key, ticket_id', [
      projectId,
    ]),
    q('select * from spec_changes where project_id = $1 order by created_at', [projectId]),
    projectSpecConfig(projectId),
  ]);
  const all = rows.rows.map(specOut);
  const shown = epicId ? all.filter((s) => s.epicId === epicId) : all;
  const ids = new Set(shown.map((s) => s.ticketId));
  const overlaps = findOverlaps(all).filter((o) => o.specs.some((s) => ids.has(s.ticketId)));
  return {
    specs: shown.map((s) => ({
      ...s,
      overlaps: overlaps.filter((o) => o.specs.some((x) => x.ticketId === s.ticketId)),
      changes: changes.rows.filter((c) => c.ticket_id === s.ticketId).map(changeOut),
    })),
    overlaps,
    config,
  };
}
/**
 * What the Code jobs page shows when "Write code" opens it from a ticket (TF-124): the ticket, its
 * coding prompt (the saved coding spec's, else one written from the ticket now), and the linked
 * repository and spec when there are any. Anyone who can open the project can read it, the same as
 * the ticket itself. { ticketId, key, title, prompt, repos: [{ label, name }], spec }.
 */
export async function codeContext(projectId, ticketId) {
  const project = await getProject(projectId);
  const ticket = (project.tickets || []).find((t) => t.id === String(ticketId));
  if (!ticket) throw new HttpError(404, 'Issue not found');
  const row = (
    await q('select * from coding_specs where project_id = $1 and ticket_id = $2', [
      projectId,
      ticket.id,
    ])
  ).rows[0];
  const spec = row ? specOut(row) : null;
  const epic = (project.epics || []).find((e) => e.id === ticket.epicId);
  const subtasks = project.tickets.filter((x) => x.parentId === ticket.id);
  const prompt = spec?.prompt || specPrompt({ project, epic, ticket, subtasks });
  const repos: { label: string; name: string }[] = [];
  const addRepo = (label, d) => {
    const name = d?.repo || String(d?.source?.url || '').replace(/\/\/[^@/]*@/, '//');
    if (name) repos.push({ label, name });
  };
  const split = Boolean(project.devBackend?.enabled);
  if (split && ticket.layer === 'backend') addRepo('Backend', project.devBackend);
  else {
    addRepo(split ? 'Frontend' : 'Repository', project.dev);
    if (split && ticket.layer === 'both') addRepo('Backend', project.devBackend);
  }
  return {
    ticketId: ticket.id,
    key: ticket.key || '',
    title: ticket.title || '',
    prompt,
    repos,
    spec: spec ? { status: spec.status, files: spec.files, modules: spec.modules } : null,
  };
}
/**
 * Saves generated specs (lib/specgen.ts), replacing each ticket's earlier spec: it goes back to
 * draft.
 */
export async function saveSpecs(projectId, epicId, generated, user) {
  requirePerm(user, 'issue.edit');
  await tx(async (t) => {
    for (const g of generated) {
      await t.query(
        `insert into coding_specs (project_id, ticket_id, epic_id, ticket_key, title, prompt, criteria, files, modules, status, generated_by, generated_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10, now())
        on conflict (project_id, ticket_id) do update set epic_id = excluded.epic_id, ticket_key = excluded.ticket_key, title = excluded.title,
          prompt = excluded.prompt, criteria = excluded.criteria, files = excluded.files, modules = excluded.modules, status = 'draft',
          generated_by = excluded.generated_by, generated_at = now(), ready_by = null, ready_at = null`,
        [
          projectId,
          g.ticketId,
          epicId,
          g.ticketKey,
          g.title,
          g.prompt,
          JSON.stringify(g.criteria),
          JSON.stringify(g.files),
          JSON.stringify(g.modules),
          user?.name || '',
        ],
      );
    }
  });
  return listSpecs(projectId, epicId);
}
/**
 * Marks specs ready for coding. When one of them overlaps another spec (same file or module), the
 * project's setting decides: 'block' refuses with a message naming the tickets and files; 'warn'
 * marks them and returns the overlaps as warnings. Specs with no overlap are marked with no
 * warning. Returns { marked, warnings }.
 */
export async function markSpecsReady(projectId, ticketIds, user) {
  requirePerm(user, 'issue.edit');
  const ids = [...new Set((Array.isArray(ticketIds) ? ticketIds : []).map(String))];
  if (!ids.length) throw new HttpError(400, 'Choose at least one spec.');
  const config = await projectSpecConfig(projectId);
  return tx(async (t) => {
    const all = (
      await t.query('select * from coding_specs where project_id = $1', [projectId])
    ).rows.map(specOut);
    const missing = ids.filter((id) => !all.some((s) => s.ticketId === id));
    if (missing.length) throw new HttpError(404, 'Generate the coding spec for this ticket first.');
    const warnings = findOverlaps(all).filter((o) => o.specs.some((s) => ids.includes(s.ticketId)));
    if (warnings.length && config.overlapMode === 'block') {
      throw new HttpError(
        409,
        `Not marked ready: ${warnings.map(describeOverlap).join('; ')}. Change the files or modules, or set overlaps to warn in the coding spec settings.`,
      );
    }
    await t.query(
      `update coding_specs set status = 'ready', ready_by = $3, ready_at = now() where project_id = $1 and ticket_id = any($2)`,
      [projectId, ids, user?.name || ''],
    );
    return { marked: ids, warnings };
  });
}
/**
 * Links AI-produced changes (a branch, pull request or commit) to a ready spec. They start pending,
 * until a reviewer approves.
 */
export async function linkSpecChange(projectId, ticketId, { ref, summary }: any, user) {
  requirePerm(user, 'issue.edit');
  const r = String(ref || '')
    .trim()
    .slice(0, 500);
  if (!r) throw new HttpError(400, 'Say which branch, pull request or commit holds the changes.');
  const spec = (
    await q('select status from coding_specs where project_id = $1 and ticket_id = $2', [
      projectId,
      String(ticketId),
    ])
  ).rows[0];
  if (!spec) throw new HttpError(404, 'Generate the coding spec for this ticket first.');
  if (spec.status !== 'ready')
    throw new HttpError(409, 'Mark the spec ready for coding before linking changes to it.');
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  await q(
    'insert into spec_changes (project_id, id, ticket_id, ref, summary, created_by) values ($1, $2, $3, $4, $5, $6)',
    [
      projectId,
      id,
      String(ticketId),
      r,
      String(summary || '')
        .trim()
        .slice(0, 2000),
      user?.name || '',
    ],
  );
  return changeOut(
    (await q('select * from spec_changes where project_id = $1 and id = $2', [projectId, id]))
      .rows[0],
  );
}
const loadChange = async (t, projectId, id) => {
  const c = (
    await t.query('select * from spec_changes where project_id = $1 and id = $2 for update', [
      projectId,
      String(id),
    ])
  ).rows[0];
  if (!c) throw new HttpError(404, 'Those changes were not found.');
  return c;
};
/** A required reviewer (coding spec settings) approves the changes. Anyone else gets 403. */
export async function approveSpecChange(projectId, changeId, user) {
  const config = await projectSpecConfig(projectId);
  if (!user || !config.reviewers.includes(user.id))
    throw new HttpError(
      403,
      'Only a required reviewer of this project can approve AI-produced changes (coding spec settings).',
    );
  return tx(async (t) => {
    const c = await loadChange(t, projectId, changeId);
    if (c.status === 'accepted') throw new HttpError(409, 'These changes are already accepted.');
    const approvals = (c.approvals || [])
      .filter((a) => a.userId !== user.id)
      .concat({ userId: user.id, name: user.name || '', at: new Date().toISOString() });
    await t.query('update spec_changes set approvals = $3 where project_id = $1 and id = $2', [
      projectId,
      c.id,
      JSON.stringify(approvals),
    ]);
    return changeOut({ ...c, approvals });
  });
}
/** Marks the changes accepted. Refused until at least one required reviewer has approved them. */
export async function acceptSpecChange(projectId, changeId, user) {
  requirePerm(user, 'issue.edit');
  const config = await projectSpecConfig(projectId);
  return tx(async (t) => {
    const c = await loadChange(t, projectId, changeId);
    if (c.status === 'accepted') return changeOut(c);
    if (!config.reviewers.length)
      throw new HttpError(
        409,
        'These changes can’t be accepted: the project has no required reviewer (coding spec settings).',
      );
    if (!(c.approvals || []).some((a) => config.reviewers.includes(a.userId)))
      throw new HttpError(
        409,
        'These changes can’t be accepted until a required reviewer has approved them.',
      );
    await t.query(
      `update spec_changes set status = 'accepted', accepted_by = $3, accepted_at = now() where project_id = $1 and id = $2`,
      [projectId, c.id, user?.name || ''],
    );
    return changeOut({
      ...c,
      status: 'accepted',
      accepted_by: user?.name || '',
      accepted_at: new Date().toISOString(),
    });
  });
}
/** One-time import of the JSON projects saved by earlier versions (data/projects/*.json). */
export async function importJsonProjects() {
  const done = (await q("select value from app_meta where key = 'json_imported'")).rows[0];
  if (done) return 0;
  const dir = path.join(DATA_DIR, 'projects');
  let n = 0;
  try {
    for (const f of (await fs.readdir(dir)).filter((x) => x.endsWith('.json'))) {
      try {
        const p = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
        if (!p.id || !Array.isArray(p.tickets)) continue;
        if ((await q('select 1 from projects where id = $1', [p.id])).rows[0]) continue;
        await createProject(p, null);
        n += 1;
      } catch (e) {
        console.warn(`Could not import ${f}: ${e.message}`);
      }
    }
  } catch {
    /* no legacy folder */
  }
  await q(
    "insert into app_meta (key, value) values ('json_imported', $1) on conflict (key) do nothing",
    [JSON.stringify({ at: new Date().toISOString(), count: n })],
  );
  return n;
}
/** The project timeline's server-side part (section changes, deleted issues), newest first. */
/**
 * One entry on the project's Activity timeline for a change kept outside the project data (its
 * database connections and test setup live in app_meta). kind is the timeline group, e.g.
 * 'settings'.
 */
export async function logActivity(projectId, user, kind, text, target = '') {
  await q(
    `insert into activity (project_id, version, user_id, author, kind, target, text)
    select id, version, $2, $3, $4, $5, $6 from projects where id = $1`,
    [projectId, user?.id || null, user?.name || '', kind, target, String(text).slice(0, 500)],
  );
}
