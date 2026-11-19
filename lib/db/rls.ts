import { APP_ROLE, dbInfo } from './context';
import { SETUP_LOCK } from './migrate';

// ---------------------------------------------------------------- RLS setup (PostgreSQL /
// Supabase)
export const TABLES = [
  'roles',
  'users',
  'sessions',
  'invites',
  'password_resets',
  'projects',
  'issues',
  'issue_tombstones',
  'activity',
  'issue_versions',
  'app_meta',
  'ai_cache',
  'ai_usage',
  'notifications',
  'screenshots',
  'files',
  'doc_templates',
  'code_jobs',
  'user_ai',
  'legal_acceptances',
  'signup_requests',
  'user_prefs',
  'workspaces',
  'workspace_members',
  'schema_migrations',
  'billing_events',
  'payment_gateways',
  'billing_plans',
  'usage_counters',
  'brain_notes',
  'brain_state',
  'coding_specs',
  'spec_changes',
  'drive_docs',
  'helper_perms',
  'ticket_drafts',
  'chat_messages',
  'api_tokens',
];
const FUNCS = [
  'tf_uid()',
  'tf_system()',
  'tf_ws()',
  'tf_can(text)',
  'tf_can_delete_project(text)',
  'tf_access(text)',
  'tf_all_access()',
  'tf_access_list()',
  'tf_ws_projects()',
  'tf_coworkers()',
  'tf_my_workspaces()',
];
const LOCKDOWN_SQL = `
${TABLES.map((t) => `alter table ${t} enable row level security`).join(';\n')};
revoke all on table ${TABLES.join(', ')} from public;
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table ${TABLES.join(', ')} from %I', r);
    end if;
  end loop;
end $$`;
/**
 * A row of project `col` is visible: system context, access to every project, or this project on
 * the user's list.
 */
const ACCESS = (col) =>
  `((select tf_system()) or (select tf_all_access()) or ${col} in (select unnest(tf_access_list())))`;
const POLICY_SQL = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = '${APP_ROLE}') then
    create role ${APP_ROLE} nologin nosuperuser nobypassrls noinherit;
  end if;
end $$;
grant ${APP_ROLE} to current_user;
grant usage on schema public to ${APP_ROLE};
grant select, insert, update, delete on table ${TABLES.join(', ')} to ${APP_ROLE};
grant usage, select on sequence activity_id_seq, issue_versions_id_seq, ai_usage_id_seq, legal_acceptances_id_seq, chat_messages_id_seq to ${APP_ROLE};

create or replace function tf_uid() returns text language sql stable set search_path = public
  as $f$ select nullif(current_setting('app.user_id', true), '') $f$;
create or replace function tf_system() returns boolean language sql stable set search_path = public
  as $f$ select coalesce(current_setting('app.system', true), '') = 'on' $f$;
create or replace function tf_ws() returns text language sql stable set search_path = public
  as $f$ select nullif(current_setting('app.workspace_id', true), '') $f$;
-- Permissions and project access come from your membership of the current workspace.
create or replace function tf_can(perm text) returns boolean language sql stable security definer set search_path = public
  as $f$ select exists (select 1 from workspace_members m join users u on u.id = m.user_id
         join roles r on r.workspace_id = m.workspace_id and r.id = m.role_id
         where m.user_id = tf_uid() and m.workspace_id = tf_ws() and m.status = 'active' and u.status = 'active'
           and (m.is_owner or r.permissions ? perm)) $f$;
-- Only the project's creator and the workspace owner may delete (archive) a project.
create or replace function tf_can_delete_project(pid text) returns boolean language sql stable security definer set search_path = public
  as $f$ select exists (select 1 from projects p where p.id = pid and p.workspace_id = tf_ws())
     and (exists (select 1 from projects p where p.id = pid and p.created_by is not null and p.created_by = tf_uid())
       or exists (select 1 from workspace_members m where m.user_id = tf_uid() and m.workspace_id = tf_ws() and m.status = 'active' and m.is_owner)) $f$;
-- Archiving or restoring a project (archived_at changes) is only for system context and those who may delete it.
create or replace function tf_project_archive() returns trigger language plpgsql security definer set search_path = public as $f$
  begin
    if (new.archived_at is distinct from old.archived_at or new.archived_by is distinct from old.archived_by)
       and not (tf_system() or (new.archived_at is not null and old.archived_at is null and tf_can_delete_project(old.id))) then
      raise exception 'Only the project creator or an owner can delete a project' using errcode = '42501';
    end if;
    return new;
  end $f$;
create or replace trigger tf_project_archive before update on projects for each row execute function tf_project_archive();
create or replace function tf_access(pid text) returns boolean language sql stable security definer set search_path = public
  as $f$ select exists (select 1 from projects p where p.id = pid and p.workspace_id = tf_ws())
     and (exists (select 1 from workspace_members m where m.user_id = tf_uid() and m.workspace_id = tf_ws() and m.status = 'active'
                  and (m.is_owner or m.project_access = '"all"'::jsonb or m.project_access ? pid))
       or exists (select 1 from projects p where p.id = pid and p.created_by is not null and p.created_by = tf_uid())) $f$;
-- For policies on tables with many rows per project (issues): these take no row argument, so wrapped in
-- (select …) Postgres works them out once per statement instead of once per row.
create or replace function tf_all_access() returns boolean language sql stable security definer set search_path = public
  as $f$ select exists (select 1 from workspace_members m where m.user_id = tf_uid() and m.workspace_id = tf_ws() and m.status = 'active'
         and (m.is_owner or m.project_access = '"all"'::jsonb)) $f$;
create or replace function tf_access_list() returns text[] language sql stable security definer set search_path = public
  as $f$ select coalesce(array(
      select jsonb_array_elements_text(case when jsonb_typeof(m.project_access) = 'array' then m.project_access else '[]'::jsonb end)
        from workspace_members m where m.user_id = tf_uid() and m.workspace_id = tf_ws() and m.status = 'active'
      union select p.id from projects p where p.created_by is not null and p.created_by = tf_uid() and p.workspace_id = tf_ws()), '{}'::text[]) $f$;
-- Workspace isolation (the restrictive tfw_ policies below).
create or replace function tf_ws_projects() returns text[] language sql stable security definer set search_path = public
  as $f$ select coalesce(array(select id from projects where workspace_id = tf_ws()), '{}'::text[]) $f$;
create or replace function tf_coworkers() returns text[] language sql stable security definer set search_path = public
  as $f$ select coalesce(array(select user_id from workspace_members where workspace_id = tf_ws()), '{}'::text[]) $f$;
create or replace function tf_my_workspaces() returns text[] language sql stable security definer set search_path = public
  as $f$ select coalesce(array(select workspace_id from workspace_members where user_id = tf_uid() and status = 'active'), '{}'::text[]) $f$;
revoke all on function ${FUNCS.join(', ')} from public;
grant execute on function ${FUNCS.join(', ')} to ${APP_ROLE};
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function ${FUNCS.join(', ')} from %I', r);
    end if;
  end loop;
end $$;

${TABLES.map((t) => `do $$ declare p record; begin for p in select policyname from pg_policies where schemaname = current_schema() and tablename = '${t}' and (policyname like 'tf\\_%' or policyname like 'tfw\\_%') loop execute format('drop policy %I on ${t}', p.policyname); end loop; end $$`).join(';\n')};

create policy tf_select on users for select to ${APP_ROLE} using (tf_system() or id = tf_uid() or id = any(tf_coworkers()));
create policy tf_write on users for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_select on roles for select to ${APP_ROLE} using (tf_system() or (tf_uid() is not null and workspace_id = tf_ws()));
create policy tf_write on roles for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on sessions for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on invites for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on password_resets for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on api_tokens for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on app_meta for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on ai_cache for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on ai_usage for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on doc_templates for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_select on projects for select to ${APP_ROLE} using (${ACCESS('id')} or (select tf_can('users.manage')));
create policy tf_insert on projects for insert to ${APP_ROLE} with check ((select tf_system()) or (select tf_can('project.create')));
create policy tf_update on projects for update to ${APP_ROLE} using ((select tf_system()) or (${ACCESS('id')} and archived_at is null)) with check (${ACCESS('id')});
create policy tf_delete on projects for delete to ${APP_ROLE} using ((select tf_system()) or (${ACCESS('id')} and tf_can_delete_project(id)));
create policy tf_all on issues for all to ${APP_ROLE} using (${ACCESS('project_id')}) with check (${ACCESS('project_id')});
create policy tf_all on issue_tombstones for all to ${APP_ROLE} using (${ACCESS('project_id')}) with check (${ACCESS('project_id')});
create policy tf_all on activity for all to ${APP_ROLE} using (${ACCESS('project_id')}) with check (${ACCESS('project_id')});
create policy tf_all on issue_versions for all to ${APP_ROLE} using (${ACCESS('project_id')}) with check (${ACCESS('project_id')});
create policy tf_all on screenshots for all to ${APP_ROLE} using (${ACCESS('project_id')}) with check (${ACCESS('project_id')});
create policy tf_all on files for all to ${APP_ROLE} using (${ACCESS('project_id')}) with check (${ACCESS('project_id')});
create policy tf_own on user_ai for all to ${APP_ROLE} using (tf_system() or user_id = tf_uid()) with check (tf_system() or user_id = tf_uid());
create policy tf_own on user_prefs for all to ${APP_ROLE} using (tf_system() or user_id = tf_uid()) with check (tf_system() or user_id = tf_uid());
create policy tf_system_only on legal_acceptances for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on signup_requests for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_select on workspaces for select to ${APP_ROLE} using (tf_system() or id = any(tf_my_workspaces()));
create policy tf_write on workspaces for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_select on workspace_members for select to ${APP_ROLE} using (tf_system() or workspace_id = tf_ws() or user_id = tf_uid());
create policy tf_write on workspace_members for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on schema_migrations for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on billing_events for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on payment_gateways for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_select on billing_plans for select to ${APP_ROLE} using (true);
create policy tf_write on billing_plans for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
create policy tf_system_only on usage_counters for all to ${APP_ROLE} using (tf_system()) with check (tf_system());
-- Workspace isolation, added on top of every rule above (restrictive): rows of another workspace never show, even to
-- someone with access to "all projects". System work stays inside the request's workspace in the app code.
${['projects', 'roles', 'invites'].map((t) => `create policy tfw_tenant on ${t} as restrictive for all to ${APP_ROLE} using (tf_system() or workspace_id = tf_ws()) with check (tf_system() or workspace_id = tf_ws())`).join(';\n')};
${['issues', 'issue_tombstones', 'activity', 'issue_versions', 'screenshots', 'files', 'code_jobs', 'brain_notes', 'brain_state', 'coding_specs', 'spec_changes', 'drive_docs', 'helper_perms', 'ticket_drafts', 'chat_messages'].map((t) => `create policy tfw_tenant on ${t} as restrictive for all to ${APP_ROLE} using ((select tf_system()) or project_id in (select unnest(tf_ws_projects()))) with check ((select tf_system()) or project_id in (select unnest(tf_ws_projects())))`).join(';\n')};
create policy tf_all on code_jobs for all to ${APP_ROLE} using (${ACCESS('project_id')}) with check (${ACCESS('project_id')});
create policy tf_all on brain_notes for all to ${APP_ROLE} using (${ACCESS('project_id')}) with check (${ACCESS('project_id')});
create policy tf_all on brain_state for all to ${APP_ROLE} using (${ACCESS('project_id')}) with check (${ACCESS('project_id')});
create policy tf_all on coding_specs for all to ${APP_ROLE} using (${ACCESS('project_id')}) with check (${ACCESS('project_id')});
create policy tf_all on spec_changes for all to ${APP_ROLE} using (${ACCESS('project_id')}) with check (${ACCESS('project_id')});
create policy tf_all on drive_docs for all to ${APP_ROLE} using (${ACCESS('project_id')}) with check (${ACCESS('project_id')});
create policy tf_all on ticket_drafts for all to ${APP_ROLE} using (${ACCESS('project_id')}) with check (${ACCESS('project_id')});
create policy tf_own on chat_messages for all to ${APP_ROLE} using (${ACCESS('project_id')} and (select tf_system() or user_id = tf_uid())) with check (${ACCESS('project_id')} and (select tf_system() or user_id = tf_uid()));
create policy tf_select on helper_perms for select to ${APP_ROLE} using (${ACCESS('project_id')});
create policy tf_write on helper_perms for all to ${APP_ROLE} using (${ACCESS('project_id')} and (select tf_system() or tf_can('project.settings'))) with check (${ACCESS('project_id')} and (select tf_system() or tf_can('project.settings')));
create policy tf_select on notifications for select to ${APP_ROLE} using (tf_system() or user_id = tf_uid());
create policy tf_insert on notifications for insert to ${APP_ROLE} with check (tf_system() or tf_uid() is not null);
create policy tf_update on notifications for update to ${APP_ROLE} using (tf_system() or user_id = tf_uid()) with check (tf_system() or user_id = tf_uid());
create policy tf_delete on notifications for delete to ${APP_ROLE} using (tf_system() or user_id = tf_uid())`;
/**
 * 1) Lock down: RLS on every table, nothing for PUBLIC / Supabase's anon & authenticated roles (so
 *    the Supabase REST API and anon key can't read or write anything).
 * 2) Policies for the app role, scoped to the signed-in user. If step 2 fails the app keeps running
 *    as the owner, and step 1 still protects the data.
 */
export async function setupRls(d) {
  const info = { enabled: false, appRole: null, tables: TABLES.length, error: null };
  if (process.env.TICKETFORGE_RLS === 'off') {
    info.error = 'Disabled with TICKETFORGE_RLS=off';
    dbInfo.rls = info;
    return;
  }
  try {
    await d.tx(async (t) => {
      await t.query(SETUP_LOCK);
      await t.query(LOCKDOWN_SQL);
    });
    info.enabled = true;
  } catch (e) {
    info.error = `Could not enable RLS: ${e.message}`;
    console.error(info.error);
    dbInfo.rls = info;
    return;
  }
  try {
    await d.tx(async (t) => {
      await t.query(SETUP_LOCK);
      await t.query(POLICY_SQL);
    });
    info.appRole = APP_ROLE;
  } catch (e) {
    info.error = `RLS is on, but the per-user policies could not be set up, so the app runs as the table owner: ${e.message}`;
    console.error(info.error);
  }
  dbInfo.rls = info;
}
