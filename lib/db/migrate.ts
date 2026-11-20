import { SCHEMA } from './schema';
import { db } from './connection';
import { G, dbInfo } from './context';
import { setupRls, TABLES } from './rls';

// Older TicketForge versions sharing the database (another server not updated yet) don't record
// issue and section versions, so browsers syncing "changes since" would miss their edits. These
// triggers record them for any writer that doesn't say it does it itself (app.writer = 2): the
// version the writer's save is about to become.
const SYNC_TRIGGERS = [
  `create or replace function tf_issue_rev() returns trigger language plpgsql security definer set search_path = public as $f$
  begin
    if coalesce(current_setting('app.writer', true), '') <> '2' then
      new.rev := coalesce((select version from projects where id = new.project_id), 0) + 1;
    end if;
    return new;
  end $f$`,
  // create or replace: one atomic step, so two servers starting at once can't trip over each other.
  'create or replace trigger tf_issue_rev before insert or update on issues for each row execute function tf_issue_rev()',
  `create or replace function tf_issue_gone() returns trigger language plpgsql security definer set search_path = public as $f$
  begin
    if coalesce(current_setting('app.writer', true), '') <> '2' then
      insert into issue_tombstones (project_id, id, rev)
        select old.project_id, old.id, p.version + 1 from projects p where p.id = old.project_id
        on conflict (project_id, id) do update set rev = excluded.rev;
    end if;
    return old;
  end $f$`,
  'create or replace trigger tf_issue_gone after delete on issues for each row execute function tf_issue_gone()',
  `create or replace function tf_project_revs() returns trigger language plpgsql security definer set search_path = public as $f$
  declare k text;
  begin
    if coalesce(current_setting('app.writer', true), '') <> '2' and new.data is distinct from old.data then
      for k in select jsonb_object_keys(new.data) union select jsonb_object_keys(old.data) loop
        if (new.data -> k) is distinct from (old.data -> k) then new.revs := coalesce(new.revs, '{}'::jsonb) || jsonb_build_object(k, new.version); end if;
      end loop;
      new.stats := jsonb_build_object('epics', coalesce(jsonb_array_length(case when jsonb_typeof(new.data -> 'epics') = 'array' then new.data -> 'epics' end), 0));
    end if;
    return new;
  end $f$`,
  'create or replace trigger tf_project_revs before update on projects for each row execute function tf_project_revs()',
];
/**
 * Taken at the start of each setup transaction: servers starting at the same time (several copies,
 * or several routes at once in development) set the database up one after another instead of
 * colliding ("already exists").
 */
export const SETUP_LOCK = 'select pg_advisory_xact_lock(7413201)';
/** Changes whenever SCHEMA does, so a running server migrates again after new tables are added. */
export const SCHEMA_VERSION = (() => {
  let h = 0;
  for (const c of SCHEMA + SYNC_TRIGGERS.join(';')) h = (h * 31 + c.charCodeAt(0)) | 0;
  return String(h);
})();
export async function migrate() {
  const d = await db();
  const wasOwner = G.owner;
  G.owner = true;
  try {
    if (dbInfo.kind === 'postgres') await checkPrivileges(d);
    // Postgres takes the whole schema in one message (one round trip; matters on every cold start
    // of a serverless deploy). The local database runs it statement by statement.
    if (dbInfo.kind === 'postgres') await d.query(`${SETUP_LOCK};\n${SCHEMA}`);
    else
      for (const stmt of SCHEMA.split(';')
        .map((s) => s.trim())
        .filter(Boolean))
        await d.query(stmt);
    // Helps older servers sharing the database stay in sync; never a reason to stop the app from
    // starting.
    try {
      await d.tx(async (t) => {
        if (dbInfo.kind === 'postgres') await t.query(SETUP_LOCK);
        for (const stmt of SYNC_TRIGGERS) await t.query(stmt);
      });
    } catch (e) {
      console.warn(`Sync triggers not updated (the app works without them): ${e.message}`);
    }
    await runMigrations(d);
    if (dbInfo.kind === 'postgres') await setupRls(d);
  } finally {
    G.owner = wasOwner;
  }
}
/**
 * One-time data changes, each recorded in schema_migrations so it never runs twice. ws-1:
 * workspaces. Roles become per workspace (key: workspace + id); everyone who had an account becomes
 * a member of the 'default' workspace with the role, project access and owner flag they had, so
 * nothing changes for them.
 */
const MIGRATIONS = [
  {
    id: 'ws-1',
    sql: [
      `do $$ begin
       if exists (select 1 from pg_constraint where conname = 'roles_pkey' and conrelid = 'roles'::regclass
                  and array_length(conkey, 1) = 1) then
         alter table roles drop constraint roles_pkey cascade;
         alter table roles add primary key (workspace_id, id);
       end if;
     end $$`,
      `insert into workspaces (id, name, owner_id)
       select 'default', 'My workspace', (select id from users order by is_owner desc, created_at limit 1)
       where exists (select 1 from users)
       on conflict (id) do nothing`,
      `insert into workspace_members (workspace_id, user_id, role_id, project_access, is_owner, status, created_at)
       select 'default', u.id, u.role_id, u.project_access, u.is_owner, u.status, u.created_at from users u
       where exists (select 1 from workspaces where id = 'default')
       on conflict (workspace_id, user_id) do nothing`,
    ],
  },
];
async function runMigrations(d) {
  const done = new Set((await d.query('select id from schema_migrations')).rows.map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await d.tx(async (t) => {
      if (dbInfo.kind === 'postgres') await t.query(SETUP_LOCK);
      if ((await t.query('select 1 from schema_migrations where id = $1', [m.id])).rows[0]) return; // another copy did it
      for (const stmt of m.sql) await t.query(stmt);
      await t.query('insert into schema_migrations (id) values ($1)', [m.id]);
    });
    console.log(`Database migration ${m.id} applied`);
  }
}
/** Fails early with a fix when the database user can't create TicketForge's tables. */
async function checkPrivileges(d) {
  const r = (
    await d.query(
      `select current_user u, has_schema_privilege(current_user, 'public', 'CREATE') can_create,
    (select count(*)::int from pg_tables where schemaname = 'public' and tablename = any($1)) existing`,
      [TABLES],
    )
  ).rows[0];
  if (r.can_create) return;
  const who = r.u.replace(/"/g, '""');
  throw new Error(
    `permission denied for schema public: the database user "${r.u}" in DATABASE_URL can't create tables there ` +
      `(${r.existing} of ${TABLES.length} TicketForge tables exist). Since PostgreSQL 15 only the database owner can, by default. Fix it as ` +
      `the database owner or a superuser, e.g. psql "<admin connection>" -c 'ALTER DATABASE <db> OWNER TO "${who}"' ` +
      `or -c 'GRANT CREATE ON SCHEMA public TO "${who}"'. On Supabase, connect as the postgres user (postgres.<project-ref> on the pooler).`,
  );
}
