export const SCHEMA = `
create table if not exists roles (
  id text primary key,
  name text not null,
  description text not null default '',
  permissions jsonb not null default '[]',
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists users (
  id text primary key,
  email text not null unique,
  name text not null,
  password_hash text not null,
  role_id text not null references roles(id),
  project_access jsonb not null default '"all"',
  is_owner boolean not null default false,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);
create table if not exists sessions (
  token_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text not null default ''
);
create table if not exists invites (
  id text primary key,
  email text not null,
  name text not null default '',
  role_id text not null references roles(id),
  project_access jsonb not null default '"all"',
  message text not null default '',
  token_hash text not null unique,
  invited_by text references users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  emailed boolean not null default false
);
alter table invites add column if not exists send_count integer not null default 1;
create table if not exists password_resets (
  token_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create table if not exists projects (
  id text primary key,
  name text not null,
  key text not null,
  data jsonb not null,
  version integer not null default 1,
  created_by text references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists issues (
  project_id text not null references projects(id) on delete cascade,
  id text not null,
  position double precision not null default 0,
  data jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (project_id, id)
);
create index if not exists issues_project_pos on issues(project_id, position);
-- Sync: rev = the project version that last wrote the issue, so a browser downloads only what changed since its
-- version ("changes since"). revs on projects does the same per settings section (and _order for the issue order).
alter table issues add column if not exists rev integer not null default 0;
create index if not exists issues_project_rev on issues(project_id, rev);
alter table issues add column if not exists is_sub boolean generated always as (coalesce(data->>'type', '') = 'Sub-task') stored;
alter table projects add column if not exists revs jsonb not null default '{}';
alter table projects add column if not exists stats jsonb;
update projects set stats = jsonb_build_object('epics', coalesce(jsonb_array_length(case when jsonb_typeof(data->'epics') = 'array' then data->'epics' end), 0)) where stats is null;
create table if not exists issue_tombstones (
  project_id text not null references projects(id) on delete cascade,
  id text not null,
  rev integer not null,
  primary key (project_id, id)
);
create index if not exists issue_tombstones_rev on issue_tombstones(project_id, rev);
create table if not exists activity (
  id bigserial primary key,
  project_id text not null references projects(id) on delete cascade,
  at timestamptz not null default now(),
  version integer,
  user_id text,
  author text not null default '',
  kind text not null default '',
  target text not null default '',
  text text not null default ''
);
create index if not exists activity_project_at on activity(project_id, at desc);
-- Ticket versions: the whole issue as it was after each status change (and after each restore), numbered per issue.
create table if not exists issue_versions (
  id bigserial primary key,
  project_id text not null references projects(id) on delete cascade,
  issue_id text not null,
  number integer not null,
  at timestamptz not null default now(),
  user_id text,
  author text not null default '',
  status text not null default '',
  restored_from integer,
  data jsonb not null,
  unique (project_id, issue_id, number)
);
create table if not exists ai_usage (
  id bigserial primary key,
  at timestamptz not null default now(),
  project_id text,
  user_id text,
  user_name text not null default '',
  task text not null default '',
  engine text not null default '',
  model text not null default '',
  tier text not null default '',
  input integer not null default 0,
  output integer not null default 0,
  cache_read integer not null default 0,
  cache_write integer not null default 0,
  estimated boolean not null default false,
  chars integer not null default 0,
  ms integer not null default 0,
  cached boolean not null default false,
  escalated boolean not null default false,
  ok boolean not null default true,
  cost double precision
);
create index if not exists ai_usage_at on ai_usage(at desc);
create index if not exists ai_usage_project on ai_usage(project_id, at desc);
create table if not exists app_meta (
  key text primary key,
  value jsonb not null
);
create table if not exists ai_cache (
  key text primary key,
  task text not null default '',
  value text not null,
  chars integer not null default 0,
  hits integer not null default 0,
  created_at timestamptz not null default now(),
  used_at timestamptz not null default now()
);
create table if not exists notifications (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  project_id text,
  issue_id text,
  kind text not null,
  title text not null,
  body text not null default '',
  link text not null default '',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user on notifications(user_id, created_at desc);
create table if not exists screenshots (
  id text primary key,
  project_id text not null,
  issue_id text,
  tc_id text not null,
  status text not null default 'Fail',
  error text not null default '',
  mime text not null default 'image/jpeg',
  bytes integer not null default 0,
  data bytea not null,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists screenshots_tc on screenshots(project_id, tc_id, created_at desc);
create table if not exists files (
  id text primary key,
  project_id text not null,
  name text not null default '',
  mime text not null default 'application/octet-stream',
  bytes integer not null default 0,
  data bytea not null,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists files_project on files(project_id);
create table if not exists user_ai (
  user_id text primary key references users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
-- Workspaces: each company's own space. People have one login (users) and a membership per workspace, which holds
-- their role, project access and whether they own it. Data from before workspaces belongs to the 'default' one.
create table if not exists workspaces (
  id text primary key,
  name text not null,
  owner_id text references users(id) on delete set null,
  plan text not null default 'free',
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table if not exists workspace_members (
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role_id text not null,
  project_access jsonb not null default '"all"',
  is_owner boolean not null default false,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists workspace_members_user on workspace_members(user_id);
-- API tokens (MCP clients): a token acts as one person in one workspace. Only a hash of it is stored.
create table if not exists api_tokens (
  id text primary key,
  token_hash text not null unique,
  user_id text not null references users(id) on delete cascade,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists api_tokens_user on api_tokens(user_id);
-- Billing (SaaS): the workspace's plan and its Stripe subscription, kept in step by the Stripe webhook.
alter table workspaces add column if not exists stripe_customer_id text;
alter table workspaces add column if not exists stripe_subscription_id text;
alter table workspaces add column if not exists subscription_status text;
alter table workspaces add column if not exists billing_interval text;
alter table workspaces add column if not exists current_period_end timestamptz;
alter table workspaces add column if not exists cancel_at_period_end boolean not null default false;
alter table workspaces add column if not exists trial_ends_at timestamptz;
alter table workspaces add column if not exists paymongo_subscription_id text;
create index if not exists workspaces_customer on workspaces(stripe_customer_id);
-- PayMongo checkout the owner was sent to and hasn't come back from yet (cleared once handled).
alter table workspaces add column if not exists paymongo_checkout_id text;
-- Which plan (and version of it) the workspace is on, and the gateway it pays with (paymongo | xendit | stripe).
alter table workspaces add column if not exists plan_version integer;
alter table workspaces add column if not exists gateway text;
-- The hosted checkout the owner was sent to and hasn't come back from yet, as "<gateway>:<session id>" (cleared once handled).
alter table workspaces add column if not exists checkout_ref text;
-- Payment gateways the owner turned on (several can be active at once). credentials holds the encrypted keys.
create table if not exists payment_gateways (
  provider text primary key,
  active boolean not null default false,
  credentials jsonb not null default '{}',
  updated_by text,
  updated_at timestamptz not null default now()
);
-- Subscription plans. Editing a plan that has subscribers adds a new version row, and workspaces keep the version they
-- subscribed to (workspaces.plan_version) and new subscriptions use the latest version.
create table if not exists billing_plans (
  id text not null,
  version integer not null,
  name text not null,
  blurb text not null default '',
  price double precision not null default 0,
  currency text not null default 'USD',
  interval text not null default 'month',
  is_free boolean not null default false,
  trial_days integer not null default 0,
  limits jsonb not null default '{}',
  features jsonb not null default '[]',
  position integer not null default 0,
  archived boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  primary key (id, version)
);
-- Stripe events already handled (Stripe can send one more than once).
create table if not exists billing_events (
  id text primary key,
  type text not null default '',
  workspace_id text,
  created_at timestamptz not null default now()
);
-- Monthly usage per workspace (platform AI calls, code jobs), counted atomically against the plan's limit.
create table if not exists usage_counters (
  workspace_id text not null,
  metric text not null,
  period text not null,
  n integer not null default 0,
  primary key (workspace_id, metric, period)
);
create table if not exists schema_migrations (
  id text primary key,
  at timestamptz not null default now()
);
alter table sessions add column if not exists workspace_id text;
alter table roles add column if not exists workspace_id text not null default 'default';
alter table invites add column if not exists workspace_id text not null default 'default';
-- Scale: sign-out everywhere, disabling a person and deleting a user (cascade) look sessions up by person, the
-- expired-session sweep looks them up by expiry, and re-sending an invite looks it up by workspace and email.
create index if not exists sessions_user on sessions(user_id);
create index if not exists sessions_expires on sessions(expires_at);
create index if not exists password_resets_user on password_resets(user_id);
create index if not exists invites_ws_email on invites(workspace_id, email);
alter table projects add column if not exists workspace_id text not null default 'default';
create index if not exists projects_workspace on projects(workspace_id, updated_at desc);
-- Soft delete: an archived project is hidden from everyone and can be restored by the app owner (archived_at = null).
alter table projects add column if not exists archived_at timestamptz;
alter table projects add column if not exists archived_by text;
alter table ai_usage add column if not exists workspace_id text not null default 'default';
create index if not exists ai_usage_workspace on ai_usage(workspace_id, at desc);
-- Consent: which version of the Terms of Use and Privacy Policy each person accepted, and when (lib/legal).
alter table users add column if not exists terms_version text;
alter table users add column if not exists terms_accepted_at timestamptz;
alter table users add column if not exists privacy_version text;
alter table users add column if not exists email_verified_at timestamptz;
create table if not exists legal_acceptances (
  id bigserial primary key,
  user_id text references users(id) on delete set null,
  email text not null default '',
  doc text not null,
  version text not null,
  accepted_at timestamptz not null default now(),
  ip text not null default '',
  user_agent text not null default ''
);
create index if not exists legal_acceptances_user on legal_acceptances(user_id);
-- People asking for an account while sign-up is a waitlist (SIGNUP_MODE=waitlist).
create table if not exists signup_requests (
  id text primary key,
  email text not null unique,
  name text not null default '',
  company text not null default '',
  note text not null default '',
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
-- Per-person preferences kept on the server, such as which guided tours someone has finished.
create table if not exists user_prefs (
  user_id text primary key references users(id) on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create table if not exists code_jobs (
  id text primary key,
  project_id text not null,
  ticket_id text not null default '',
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists code_jobs_project on code_jobs(project_id, ticket_id);
create table if not exists doc_templates (
  key text primary key,
  name text not null default '',
  bytes integer not null default 0,
  data bytea not null,
  info jsonb not null default '{}',
  updated_by text,
  updated_at timestamptz not null default now()
);
-- Project brain (lib/brain.ts): an Obsidian-style vault of Markdown notes per project. kind 'auto' notes are written
-- from the project by TicketForge (rebuilt when it changes), kind 'user' notes are people's own and never overwritten.
create table if not exists brain_notes (
  project_id text not null references projects(id) on delete cascade,
  id text not null,
  kind text not null default 'user',
  type text not null default 'note',
  key text not null default '',
  ref text not null default '',
  title text not null default '',
  status text not null default '',
  tags jsonb not null default '[]',
  links jsonb not null default '[]',
  meta jsonb not null default '{}',
  body text not null default '',
  hash text not null default '',
  updated_by text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (project_id, id)
);
create index if not exists brain_notes_ref on brain_notes(project_id, ref);
create table if not exists brain_state (
  project_id text primary key references projects(id) on delete cascade,
  version integer not null default 0,
  rev integer not null default 0,
  built_at timestamptz,
  data jsonb not null default '{}'
);
-- Coding specs (lib/specs.ts): one AI coding prompt per ticket of an epic, with the files and modules it is expected to
-- touch. status is draft or ready, and generating specs again replaces the same ticket's spec.
create table if not exists coding_specs (
  project_id text not null references projects(id) on delete cascade,
  ticket_id text not null,
  epic_id text not null default '',
  ticket_key text not null default '',
  title text not null default '',
  prompt text not null default '',
  criteria jsonb not null default '[]',
  files jsonb not null default '[]',
  modules jsonb not null default '[]',
  status text not null default 'draft',
  generated_by text not null default '',
  generated_at timestamptz not null default now(),
  ready_by text,
  ready_at timestamptz,
  primary key (project_id, ticket_id)
);
create index if not exists coding_specs_epic on coding_specs(project_id, epic_id);
-- AI-produced changes linked to a spec (a branch, pull request or commit). They can be accepted only after a required
-- reviewer (Coding specs settings) has approved them: approvals is a list of { userId, name, at }.
create table if not exists spec_changes (
  project_id text not null references projects(id) on delete cascade,
  id text not null,
  ticket_id text not null,
  ref text not null default '',
  summary text not null default '',
  status text not null default 'pending',
  approvals jsonb not null default '[]',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  accepted_by text,
  accepted_at timestamptz,
  primary key (project_id, id)
);
create index if not exists spec_changes_ticket on spec_changes(project_id, ticket_id);
-- Documents saved to the workspace's shared Google Drive folder (lib/gdrive.ts). state: saved, queued (waiting for a retry)
-- or failed (gave up after the maximum retries). The bytes are kept only while queued, so nothing is stored here once the
-- document is in Drive. One row per document: writing it again replaces the row.
create table if not exists drive_docs (
  project_id text not null references projects(id) on delete cascade,
  epic_id text not null,
  kind text not null,
  doc_key text not null default '',
  name text not null default '',
  mime text not null default '',
  state text not null default 'queued',
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  last_error text not null default '',
  drive_file_id text not null default '',
  data bytea,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, epic_id, kind, doc_key)
);
create index if not exists drive_docs_queue on drive_docs(state, next_attempt_at);
-- AI helper (lib/helper.ts, its panel was replaced by the chatbot below). helper_perms: what each person may do with the helper in one
-- project (search, generate, assign). No row means the defaults (search only). ticket_drafts: tickets the helper
-- generated. They are not issues: a draft only becomes an issue when a person approves it. Its status is draft,
-- approved or discarded, and issue_id is the issue it became. (No semicolons in these comments: PGlite splits on them.)
create table if not exists helper_perms (
  project_id text not null references projects(id) on delete cascade,
  user_id text not null,
  can_search boolean not null default true,
  can_generate boolean not null default false,
  can_assign boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create table if not exists ticket_drafts (
  project_id text not null references projects(id) on delete cascade,
  id text not null,
  idea text not null default '',
  data jsonb not null,
  status text not null default 'draft',
  created_by text,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz,
  issue_id text,
  primary key (project_id, id)
);
create index if not exists ticket_drafts_status on ticket_drafts(project_id, status, created_at desc);
-- Ticket Forge AI (client/Assistant/, lib/assistant/, lib/chat.ts). chat_messages: one person's conversation with the assistant in one
-- project, restored when the panel opens. role is user or assistant, and content is the text. An assistant message
-- that proposed an issue also keeps the draft preview in draft (it is not an issue until the person clicks Create).
create table if not exists chat_messages (
  id bigserial primary key,
  project_id text not null references projects(id) on delete cascade,
  user_id text not null,
  role text not null,
  content text not null default '',
  draft jsonb,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_thread on chat_messages(project_id, user_id, id);
`;
