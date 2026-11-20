// The project's AI chatbot (the chat panel on the project page and the refine board; it replaced
// the AI helper panel).
// A person asks for an issue in plain words and the assistant answers with a draft preview (title,
// description, type, story points, priority, acceptance criteria). The draft is not an issue:
// nothing is written to issues until the person clicks Create, and they may edit the draft first.
// The conversation is saved per person and per project (chat_messages) and restored when the panel
// opens; nobody else's messages are ever returned. Every request is an AI call, so it is recorded
// in ai_usage (who, project, workspace) and stopped by the plan's AI limit like any other AI
// action.
// Any workspace user who can open the project can chat; Create needs the issue.create permission,
// as everywhere else.
import { q, tx } from './db';
import { HttpError } from './auth';
import { requireProject, requirePerm, getProject, noteVersion } from './store';
import { normTicket } from './model';
import { insertIssue } from './helper';

const MESSAGE_MAX = 2000;
const HISTORY_MAX = 200;
const TITLE_MAX = 200;
const TEXT_MAX = 8000;
const CRITERION_MAX = 500;
const CRITERIA_MAX = 30;

const messageOut = (r) => ({
  id: String(r.id),
  role: r.role,
  content: r.content,
  draft: r.draft || null,
  createdAt: r.created_at,
});

/**
 * This person's messages in this project, oldest first. Only theirs: the query is by user as well
 * as by project.
 */
export async function chatHistory(projectId: string, user) {
  await requireProject(user, projectId);
  const { rows } = await q(
    `select * from (select * from chat_messages where project_id = $1 and user_id = $2 order by id desc limit ${HISTORY_MAX}) m order by id`,
    [projectId, user.id],
  );
  return { messages: rows.map(messageOut) };
}

/**
 * The fields of a draft the preview shows and the person may edit; anything else the client sends
 * is dropped.
 */
export function cleanDraft(input: any) {
  const title = String(input?.title ?? '').trim();
  if (!title) throw new HttpError(400, 'Give the issue a title before creating it.');
  if (title.length > TITLE_MAX)
    throw new HttpError(400, `Keep the title under ${TITLE_MAX} characters.`);
  const description = String(input?.description ?? '').trim();
  if (description.length > TEXT_MAX)
    throw new HttpError(400, `Keep the description under ${TEXT_MAX} characters.`);
  const criteria = (
    Array.isArray(input?.acceptanceCriteria)
      ? input.acceptanceCriteria
      : String(input?.acceptanceCriteria ?? '').split('\n')
  )
    .map((c) => String(c ?? '').trim())
    .filter(Boolean);
  if (criteria.length > CRITERIA_MAX || criteria.some((c) => c.length > CRITERION_MAX))
    throw new HttpError(
      400,
      `Use at most ${CRITERIA_MAX} acceptance criteria of ${CRITERION_MAX} characters.`,
    );
  // normTicket brings type, priority and story points to the values the app knows.
  const n = normTicket(
    { ...input, title, description, acceptanceCriteria: criteria },
    input?.epicId ?? null,
  );
  const { id: _i, key: _k, status: _s, assignee: _a, ...ticket } = n;
  return ticket;
}

/**
 * The newest draft of the conversation that is still open (not created, not discarded): a new
 * request refines it.
 */
const openDraft = (rows) =>
  rows.find((r) => r.draft && !r.draft.created && !r.draft.discarded)?.draft || null;

/**
 * One turn of the chat. The assistant (the same AI call as New issue, task "tickets") turns the
 * request into a draft; the request and the answer are saved together afterwards, so a request the
 * plan limit stopped (402 from the AI call, before anything is sent) leaves no trace. `write` is
 * the AI call; tests stand it in.
 */
export async function sendChatMessage(
  projectId: string,
  user,
  input: any,
  write?: (a: any) => Promise<any>,
) {
  await requireProject(user, projectId);
  const text = String(input?.message || '').trim();
  if (!text) throw new HttpError(400, 'Type what you want the issue to be about.');
  if (text.length > MESSAGE_MAX)
    throw new HttpError(400, `Keep the message under ${MESSAGE_MAX} characters.`);
  const project = await getProject(projectId);
  const earlier = (
    await q(
      'select draft from chat_messages where project_id = $1 and user_id = $2 and draft is not null order by id desc limit 5',
      [projectId, user.id],
    )
  ).rows;
  const current = openDraft(earlier);
  const answers = current
    ? `The person is refining this draft ticket (JSON): ${JSON.stringify({ ...current, testCases: undefined }).slice(0, 3000)}\nApply their new request to it and return the whole updated ticket.`
    : '';
  const run = write || (await import('./generate')).newTicket;
  const { ticket } = await run({ epicId: null, project, idea: text, answers, ai: input?.ai || {} });
  const { id: _i, key: _k, status: _s, assignee: _a, ...draft } = normTicket(ticket || {}, null);
  const reply = `I drafted “${draft.title}”. Check it below, change anything you like, then click Create.`;
  const saved = await tx(async (t) => {
    const ins =
      'insert into chat_messages (project_id, user_id, role, content, draft) values ($1,$2,$3,$4,$5) returning *';
    const mine = (await t.query(ins, [projectId, user.id, 'user', text, null])).rows[0];
    const bot = (
      await t.query(ins, [projectId, user.id, 'assistant', reply, JSON.stringify(draft)])
    ).rows[0];
    return [mine, bot];
  });
  return { messages: saved.map(messageOut) };
}

/**
 * Create: the (possibly edited) draft becomes one issue of this project, written like any issue
 * save (next key, first workflow status, end of the backlog, rev and updated_by set, new project
 * version so other browsers pick it up). The chat message keeps a note of the issue it became, so
 * the preview stays closed when the chat is restored. An empty title is refused (400) and nothing
 * is written.
 */
export async function createFromDraft(projectId: string, messageId: string, user, input: any) {
  await requireProject(user, projectId);
  requirePerm(user, 'issue.create');
  const ticket = cleanDraft(input);
  const out = await tx(async (t) => {
    const msg = (
      await t.query(
        'select * from chat_messages where id = $1 and project_id = $2 and user_id = $3 for update',
        [safeId(messageId), projectId, user.id],
      )
    ).rows[0];
    if (!msg || !msg.draft) throw new HttpError(404, 'Draft not found');
    if (msg.draft.created)
      throw new HttpError(409, `That draft was already created as ${msg.draft.created.key}.`);
    const pr = (
      await t.query(
        'update projects set version = version + 1, updated_at = now() where id = $1 and archived_at is null returning version, data',
        [projectId],
      )
    ).rows[0];
    if (!pr) throw new HttpError(404, 'Project not found');
    const issue = await insertIssue(t, projectId, pr, user, ticket, 'an AI chat draft');
    const created = { id: issue.id, key: issue.key, title: issue.title };
    await t.query('update chat_messages set draft = $2 where id = $1', [
      msg.id,
      JSON.stringify({ ...msg.draft, ...ticket, created }),
    ]);
    await t.query(
      "insert into activity (project_id, version, user_id, author, kind, target, text) values ($1,$2,$3,$4,'issue',$5,$6)",
      [
        projectId,
        pr.version,
        user.id,
        user.name || '',
        issue.key,
        `created ${issue.key} “${String(issue.title).slice(0, 120)}” from an AI chat draft`,
      ],
    );
    return { version: pr.version, issue: created };
  });
  noteVersion(projectId, out.version);
  return out;
}

/**
 * Closes a draft preview without creating anything; the preview stays closed when the chat is
 * restored.
 */
export async function discardChatDraft(projectId: string, messageId: string, user) {
  await requireProject(user, projectId);
  const { rows } = await q(
    `update chat_messages set draft = draft || '{"discarded": true}'::jsonb
      where id = $1 and project_id = $2 and user_id = $3 and draft is not null and (draft->'created') is null returning id`,
    [safeId(messageId), projectId, user.id],
  );
  if (!rows.length) throw new HttpError(404, 'Draft not found');
  return { ok: true };
}

const safeId = (id: string) => {
  if (!/^\d{1,15}$/.test(String(id))) throw new HttpError(404, 'Draft not found');
  return id;
};
