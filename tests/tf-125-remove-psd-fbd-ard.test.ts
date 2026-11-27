// TF-125: the data migration that deleted PSD, FBD and ARD documents (and only them) for good.
// The documents themselves are back in the app (Problem Statement, Feature Brief, Architecture
// Record Design per epic); the first tests check that, the rest check the old migration script.
// Run with `npm test`. The data tests use an in-memory PostgreSQL (PGlite), never a real database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { removePsdFbdArd, survey, MIGRATION_ID } from '../lib/remove-psd-fbd-ard';

// ---------------------------------------------------------------- the documents are back

test('the Word export builds PSD, FBD and ARD again, and still the Agent doc', async () => {
  const { epicDocx } = await import('../lib/epic-docx');
  const epic = { id: 'e1', title: 'Checkout' };
  for (const [kind, name] of [
    ['fbd', /Feature Brief - Checkout - v1\.0\.docx/],
    ['ard', /Architecture Record Design - Checkout - v1\.0\.docx/],
  ] as const) {
    const out = await epicDocx({ kind, epic, doc: { markdown: '# x\n\n## One\n\nHello' } });
    assert.match(out.name, name);
    assert.ok(out.buf.length > 0);
  }
  const { buildPlainPsdDocx } = await import('../lib/psd-docx');
  const { normalizePsd } = await import('../lib/psd');
  const psd = normalizePsd({ problemStatement: 'Checkout loses carts.' }, { epic });
  const buf = await buildPlainPsdDocx(psd, { version: 'v1.0', status: 'Draft' });
  assert.ok(buf.length > 0);
  const agent = await epicDocx({
    kind: 'agent',
    epic,
    doc: { name: 'Kick Off', markdown: '# Kick Off\n\nHello' },
    agentId: 'kick-off',
  });
  assert.match(agent.name, /Kick Off - Checkout\.docx/);
  await assert.rejects(epicDocx({ kind: 'nope', epic, doc: {} }), (e: any) => e.status === 404);
});

test('the PSD, FBD and ARD agents and the Epic documents feature are back', async () => {
  const { AGENTS } = await import('../lib/agents');
  const ids = AGENTS.map((a: any) => a.id);
  for (const id of ['problem-statement', 'feature-brief', 'architecture-record'])
    assert.ok(ids.includes(id), `${id} should be in the catalog`);
  const { FEATURES } = await import('../lib/features');
  assert.ok(FEATURES.some((f: any) => f.id === 'docs'));
});

// ---------------------------------------------------------------- AC 2 to 5: the data migration

async function seeded() {
  const db = new PGlite();
  await db.exec(`
    create table projects (id text primary key, name text not null, key text not null, data jsonb not null, version integer not null default 1,
      revs jsonb not null default '{}', updated_at timestamptz not null default now());
    create table files (id text not null, project_id text not null, name text not null default '', data bytea, primary key (project_id, id));
    create table drive_docs (project_id text not null, epic_id text not null, kind text not null, doc_key text not null default '', name text not null default '',
      primary key (project_id, epic_id, kind, doc_key));
    create table epic_doc_versions (project_id text not null, epic_id text not null, kind text not null, number integer not null, file_id text not null default '',
      text text not null default '', primary key (project_id, epic_id, kind, number));
    create table epic_doc_reviews (project_id text not null, epic_id text not null, kind text not null, number integer not null, user_id text not null,
      decision text not null, primary key (project_id, epic_id, kind, number, user_id));
    create table epic_doc_comments (id text not null, project_id text not null, epic_id text not null, kind text not null, number integer not null,
      body text not null default '', primary key (project_id, id));
    create table doc_templates (key text primary key, name text not null, data bytea not null default ''::bytea);
    create table brain_notes (project_id text not null, id text not null, kind text not null default 'user', type text not null default 'note',
      tags jsonb not null default '[]', body text not null default '', primary key (project_id, id));
    create table ai_cache (key text primary key, task text not null default '', value text not null);
  `);
  const epics = [
    {
      id: 'e1',
      title: 'Checkout',
      psd: { problemStatement: 'secret problem' },
      fbd: { markdown: '# FBD' },
      ard: { markdown: '# ARD' },
      agentDocs: { 'kick-off': { markdown: '# Kick Off' } },
    },
    { id: 'e2', title: 'Profile', description: 'no documents' },
    { id: 'e3', title: 'Search', fbd: { markdown: '# only a brief' } },
  ];
  await db.query(
    "insert into projects (id, name, key, data, version, revs) values ('p1', 'Shop', 'SH', $1, 7, '{\"epics\": 5}'), ('p2', 'Blog', 'BL', $2, 3, '{}')",
    [
      JSON.stringify({ epics, sprints: [] }),
      JSON.stringify({ epics: [{ id: 'b1', title: 'Posts' }] }),
    ],
  );
  for (const kind of ['psd', 'fbd', 'ard', 'agent']) {
    await db.query(
      "insert into drive_docs (project_id, epic_id, kind, doc_key, name) values ('p1', 'e1', $1, $2, $1)",
      [kind, kind === 'agent' ? 'kick-off' : ''],
    );
    await db.query("insert into files (id, project_id, name) values ($1, 'p1', $2)", [
      `f-${kind}`,
      `${kind}.pdf`,
    ]);
    await db.query(
      "insert into epic_doc_versions (project_id, epic_id, kind, number, file_id, text) values ('p1', 'e1', $1, 1, $2, 'text')",
      [kind, `f-${kind}`],
    );
    await db.query(
      "insert into epic_doc_reviews (project_id, epic_id, kind, number, user_id, decision) values ('p1', 'e1', $1, 1, 'u1', 'approved')",
      [kind],
    );
    await db.query(
      "insert into epic_doc_comments (id, project_id, epic_id, kind, number, body) values ($1, 'p1', 'e1', $2, 1, 'looks good')",
      [`c-${kind}`, kind],
    );
  }
  await db.query(
    "insert into files (id, project_id, name) values ('f-attachment', 'p1', 'screenshot.png')",
  );
  for (const key of ['psd', 'fbd:p1', 'ws:acme:ard', 'ws:acme:psd:p9', 'agent-kickoff', 'psdx'])
    await db.query('insert into doc_templates (key, name) values ($1, $1)', [key]);
  await db.exec(`insert into brain_notes (project_id, id, kind, type, tags) values
    ('p1', 'n-doc', 'auto', 'doc', '["psd"]'), ('p1', 'n-dec', 'auto', 'decision', '["architecture"]'), ('p1', 'n-q-fbd', 'auto', 'question', '["open-decision"]'),
    ('p1', 'n-q-project', 'auto', 'question', '["open-question"]'), ('p1', 'n-issue', 'auto', 'issue', '[]'), ('p1', 'n-mine', 'user', 'doc', '[]');
    insert into ai_cache (key, task, value) values ('k1', 'docs', 'psd text'), ('k2', 'tickets', 'tickets');`);
  // The migration's query function, as the script gives it (rows and rowCount, inside one
  // transaction).
  const q = async (sql: string, params: any[] = []) => {
    const r: any = await db.query(sql, params);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  const inTx = async (fn: (query: typeof q) => Promise<any>) => {
    await db.exec('begin');
    try {
      const out = await fn(q);
      await db.exec('commit');
      return out;
    } catch (e) {
      await db.exec('rollback');
      throw e;
    }
  };
  const col = async (sql: string) =>
    (await db.query<any>(sql)).rows.map((r) => Object.values(r)[0]);
  return { db, q, inTx, col };
}

test('AC2: PSD, FBD and ARD documents, versions, reviews and comments are deleted', async () => {
  const { q, inTx, col } = await seeded();
  const before = await survey(q);
  assert.deepEqual(
    before.kinds.drive_docs,
    ['agent', 'ard', 'fbd', 'psd'],
    'the survey shows which kinds are in the data',
  );
  assert.equal(before.counts.epics, 2);
  const { skipped, counts } = await inTx(removePsdFbdArd);
  assert.equal(skipped, false);
  assert.deepEqual(
    {
      drive_docs: counts.drive_docs,
      epic_doc_versions: counts.epic_doc_versions,
      epic_doc_reviews: counts.epic_doc_reviews,
      epic_doc_comments: counts.epic_doc_comments,
      files: counts.files,
    },
    { drive_docs: 3, epic_doc_versions: 3, epic_doc_reviews: 3, epic_doc_comments: 3, files: 3 },
  );
  for (const t of ['drive_docs', 'epic_doc_versions', 'epic_doc_reviews', 'epic_doc_comments'])
    assert.deepEqual(await col(`select distinct kind from ${t}`), ['agent'], t);
  const data = (await col("select data from projects where id = 'p1'"))[0] as any;
  for (const e of data.epics)
    for (const k of ['psd', 'fbd', 'ard'])
      assert.equal(k in e, false, `${e.id}.${k} should be gone`);
  assert.deepEqual(
    await col('select id from brain_notes order by id'),
    ['n-issue', 'n-mine', 'n-q-project'],
    'notes copied from the documents are gone',
  );
  assert.deepEqual(await col('select key from ai_cache order by key'), ['k2']);
});

test('AC3: the PSD, FBD and ARD doc_templates rows no longer exist', async () => {
  const { inTx, col } = await seeded();
  await inTx(removePsdFbdArd);
  assert.deepEqual(await col('select key from doc_templates order by key'), [
    'agent-kickoff',
    'psdx',
  ]);
});

test('AC4: the Agent doc and other data stay unchanged', async () => {
  const { inTx, col } = await seeded();
  await inTx(removePsdFbdArd);
  const p1 = (await col("select data from projects where id = 'p1'"))[0] as any;
  assert.deepEqual(
    p1.epics.map((e: any) => e.id),
    ['e1', 'e2', 'e3'],
    'epics keep their order',
  );
  assert.deepEqual(p1.epics[0].agentDocs, { 'kick-off': { markdown: '# Kick Off' } });
  assert.equal(p1.epics[1].description, 'no documents');
  assert.deepEqual(await col('select id from files order by id'), ['f-agent', 'f-attachment']);
  assert.deepEqual(await col('select body from epic_doc_comments'), ['looks good']);
  const p2 = (await col("select version from projects where id = 'p2'"))[0];
  assert.equal(p2, 3, 'a project without documents is not touched');
  assert.deepEqual(
    await col("select version from projects where id = 'p1'"),
    [8],
    'a changed project gets a new version',
  );
  assert.deepEqual(await col("select revs from projects where id = 'p1'"), [{ epics: 8 }]);
});

test('AC5: the run is recorded in schema_migrations, and a second run changes nothing', async () => {
  const { inTx, col } = await seeded();
  await inTx(removePsdFbdArd);
  assert.deepEqual(await col('select id from schema_migrations'), [MIGRATION_ID]);
  const again = await inTx(removePsdFbdArd);
  assert.equal(again.skipped, true);
  assert.deepEqual(
    await col("select version from projects where id = 'p1'"),
    [8],
    'no second version bump',
  );
});

test('AC2: a failure part-way changes nothing (one transaction)', async () => {
  const { q, inTx, col } = await seeded();
  const failing = async (sql: string, params?: any[]) => {
    if (/delete from brain_notes/.test(sql)) throw new Error('disk full');
    return q(sql, params);
  };
  await assert.rejects(
    inTx(() => removePsdFbdArd(failing)),
    /disk full/,
  );
  assert.deepEqual(await col('select count(*)::int from drive_docs'), [4]);
  assert.deepEqual(await col('select count(*)::int from doc_templates'), [6]);
  assert.deepEqual(
    await col("select to_regclass('public.schema_migrations')::text"),
    [null],
    'not recorded either',
  );
});
