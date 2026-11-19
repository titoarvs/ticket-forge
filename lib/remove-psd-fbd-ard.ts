// TF-125: permanently removes every Problem Statement (PSD), Feature Brief (FBD) and Architecture
// Record Design (ARD) from a database, after the features themselves were removed from the app. Run
// it once per database (Test, then production) with scripts/remove-psd-fbd-ard.ts, after a backup.
// It can't be undone.
//
// What it deletes, all in one transaction:
//   drive_docs the Google Drive save state (and any queued file bytes) of PSD, FBD and ARD
//   documents epic_doc_comments comments on uploaded PSD, FBD and ARD versions epic_doc_reviews
//   reviewers' decisions on those versions files the uploaded PSD, FBD and ARD files those versions
//   point to epic_doc_versions the uploaded versions themselves doc_templates the team (key "psd",
//   or "ws:<workspace>:psd") and project ("psd:<projectId>") templates, same for fbd and ard
//   projects.data the psd, fbd and ard documents kept on each epic (the generated ones) brain_notes
//   the brain's generated notes copied from those documents (types doc and decision, and the
//                          open decisions read from Feature Briefs); a refresh rebuilds the rest
//   ai_cache cached AI answers of the removed "docs" task (they hold document text)
// Agent documents (drive_docs kind 'agent', epic.agentDocs) and everything else stay as they are.
// The run is recorded in schema_migrations as MIGRATION_ID, and a second run does nothing.

export const MIGRATION_ID = 'tf-125-remove-psd-fbd-ard';
export const KINDS = ['psd', 'fbd', 'ard'];
// doc_templates keys: "psd" (default workspace), "ws:<id>:psd" (another workspace),
// "psd:<projectId>" (one project).
export const TEMPLATE_KEY = '^(ws:[^:]+:)?(psd|fbd|ard)(:.+)?$';

type Query = (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
export type Counts = Record<string, number>;

const exists = async (q: Query, table: string) =>
  Boolean((await q('select to_regclass($1) as t', [`public.${table}`])).rows[0]?.t);
const n = (r: { rows: any[]; rowCount?: number | null }) =>
  Number(r.rowCount ?? r.rows.length ?? 0);

/**
 * What a run would delete, and which `kind` values each table actually holds (to check before
 * deleting).
 */
export async function survey(q: Query) {
  const counts: Counts = {};
  const kinds: Record<string, string[]> = {};
  for (const t of ['drive_docs', 'epic_doc_comments', 'epic_doc_reviews', 'epic_doc_versions']) {
    if (!(await exists(q, t))) {
      counts[t] = 0;
      kinds[t] = [];
      continue;
    }
    kinds[t] = (await q(`select distinct kind from ${t} order by kind`)).rows.map((r) => r.kind);
    counts[t] = Number(
      (await q(`select count(*)::int as n from ${t} where kind = any($1)`, [KINDS])).rows[0].n,
    );
  }
  counts.files = (await exists(q, 'epic_doc_versions'))
    ? Number(
        (
          await q(
            `select count(*)::int as n from files f where exists (select 1 from epic_doc_versions v
        where v.kind = any($1) and v.project_id = f.project_id and v.file_id = f.id)`,
            [KINDS],
          )
        ).rows[0].n,
      )
    : 0;
  counts.doc_templates = (await exists(q, 'doc_templates'))
    ? Number(
        (await q('select count(*)::int as n from doc_templates where key ~ $1', [TEMPLATE_KEY]))
          .rows[0].n,
      )
    : 0;
  counts.epics = Number(
    (
      await q(
        `select count(*)::int as n from projects p, jsonb_array_elements(coalesce(p.data->'epics', '[]'::jsonb)) e
    where e ?| $1`,
        [KINDS],
      )
    ).rows[0].n,
  );
  counts.brain_notes = (await exists(q, 'brain_notes'))
    ? Number(
        (
          await q(`select count(*)::int as n from brain_notes
    where kind = 'auto' and (type in ('doc', 'decision') or (type = 'question' and tags ? 'open-decision'))`)
        ).rows[0].n,
      )
    : 0;
  counts.ai_cache = (await exists(q, 'ai_cache'))
    ? Number((await q("select count(*)::int as n from ai_cache where task = 'docs'")).rows[0].n)
    : 0;
  const done =
    (await exists(q, 'schema_migrations')) &&
    (await q('select 1 from schema_migrations where id = $1', [MIGRATION_ID])).rows.length > 0;
  return { counts, kinds, done };
}

/**
 * Deletes everything listed above. `q` must run inside one transaction (the script and the tests
 * both do), so a failure part-way changes nothing. Returns how many rows went from each place, or {
 * skipped: true } when the migration is already recorded.
 */
export async function removePsdFbdArd(q: Query): Promise<{ skipped: boolean; counts: Counts }> {
  await q(
    'create table if not exists schema_migrations (id text primary key, at timestamptz not null default now())',
  );
  if ((await q('select 1 from schema_migrations where id = $1', [MIGRATION_ID])).rows.length)
    return { skipped: true, counts: {} };
  const counts: Counts = {};
  if (await exists(q, 'drive_docs'))
    counts.drive_docs = n(await q('delete from drive_docs where kind = any($1)', [KINDS]));
  if (await exists(q, 'epic_doc_comments'))
    counts.epic_doc_comments = n(
      await q('delete from epic_doc_comments where kind = any($1)', [KINDS]),
    );
  if (await exists(q, 'epic_doc_reviews'))
    counts.epic_doc_reviews = n(
      await q('delete from epic_doc_reviews where kind = any($1)', [KINDS]),
    );
  if (await exists(q, 'epic_doc_versions')) {
    // The uploaded files first, while the versions still say which ones they are.
    counts.files = n(
      await q(
        `delete from files f using epic_doc_versions v
      where v.kind = any($1) and v.project_id = f.project_id and v.file_id = f.id`,
        [KINDS],
      ),
    );
    counts.epic_doc_versions = n(
      await q('delete from epic_doc_versions where kind = any($1)', [KINDS]),
    );
  }
  if (await exists(q, 'doc_templates'))
    counts.doc_templates = n(await q('delete from doc_templates where key ~ $1', [TEMPLATE_KEY]));
  // Each epic without its psd, fbd and ard, in the same order. The project gets a new version (and
  // the epics section its revision), so open browsers and running servers read the project again.
  const projects = await q(
    `update projects p set
      data = jsonb_set(p.data, '{epics}', (select coalesce(jsonb_agg(e - 'psd' - 'fbd' - 'ard' order by i), '[]'::jsonb)
        from jsonb_array_elements(p.data->'epics') with ordinality as x(e, i))),
      version = p.version + 1,
      revs = coalesce(p.revs, '{}'::jsonb) || jsonb_build_object('epics', p.version + 1),
      updated_at = now()
    where jsonb_typeof(p.data->'epics') = 'array'
      and exists (select 1 from jsonb_array_elements(p.data->'epics') e where e ?| $1)
    returning p.id`,
    [KINDS],
  );
  counts.projects = n(projects);
  if (await exists(q, 'brain_notes')) {
    counts.brain_notes = n(
      await q(`delete from brain_notes where kind = 'auto'
      and (type in ('doc', 'decision') or (type = 'question' and tags ? 'open-decision'))`),
    );
  }
  if (await exists(q, 'ai_cache'))
    counts.ai_cache = n(await q("delete from ai_cache where task = 'docs'"));
  await q('insert into schema_migrations (id) values ($1)', [MIGRATION_ID]);
  return { skipped: false, counts };
}
