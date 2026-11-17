// The help chatbot: rule-based, no AI. It answers from the FAQ below and from live ticket data. Ticket data is limited
// by the person's role: only projects they have access to, and people counts only with "Manage users and access".
import { q, qs } from './db';
import { canAccess, has } from './store';

/** Help content. `k`: words or phrases that point to the entry (matched anywhere in the question). */
export const FAQ = [
  { id: 'projects', k: ['create a project', 'new project', 'import a project', 'start a project', 'upload a document', 'requirement document'],
    a: 'To start a project, choose “New” in the top bar, upload a requirements document (or start blank) and TicketForge turns it into epics, tickets, acceptance criteria and test cases. You need the “Create and import projects” permission.' },
  { id: 'tickets', k: ['create a ticket', 'create an issue', 'new ticket', 'new issue', 'add a ticket', 'add an issue', 'edit a ticket', 'edit an issue'],
    a: 'Open a project and use “Create” to add an issue, or click any issue to open it and edit its fields, acceptance criteria and test cases. Creating and editing need the “Create issues” and “Edit issues” permissions.' },
  { id: 'board', k: ['board', 'sprint', 'backlog', 'kanban'],
    a: 'The Board shows the active sprint as columns, one per workflow status: drag an issue to change its status. Sprints are planned from the Backlog, and managing them needs the “Manage sprints” permission.' },
  { id: 'versions', k: ['version history', 'restore a version', 'issue version', 'previous version', 'undo a status'],
    a: 'Every status change saves the full ticket as a version. Open the ticket, go to Activity → Versions to view, compare or restore one. Restoring is for administrators and project leads.' },
  { id: 'ai', k: ['ai', 'claude', 'generate', 'enhance', 'artificial'],
    a: 'AI actions (generate a backlog, enhance or split an issue, write test cases) need the “Use Claude” permission and a connected AI, shown in the pill at the top. The owner can set the AI up in Administration → AI.' },
  { id: 'tests', k: ['test case', 'test cases', 'automation', 'playwright', 'run tests'],
    a: 'Test cases belong to each issue and are collected on the Tests page. With “Run test automation” you can run them with Playwright from the Automation page.' },
  { id: 'export', k: ['export', 'download', 'excel', 'csv', 'pdf', 'word'],
    a: 'Use the Export menu in the top bar to download Excel, Word, PDF, HTML or CSV reports, or a JSON backup of the project. It needs the “Export” permission.' },
  { id: 'roles', k: ['role', 'permission', 'access', 'invite', 'invite a user', 'add a user', 'team member'],
    a: 'Roles are sets of permissions, and each person also has project access (all projects, or chosen ones). Administrators invite people and change roles in Administration → Users.' },
  { id: 'password', k: ['password', 'sign in', 'log in', 'login', 'forgot'],
    a: 'On the sign-in page choose “Forgot password” and we’ll email you a reset link. You can change your password from your account menu.' },
  { id: 'release', k: ['release note', 'release notes', 'what is new', "what's new", 'new feature', 'app version', 'which version'],
    a: 'The app version is shown at the top of the sidebar, and every release with its features is listed on the Release notes page (link in the footer).' },
];

export const FALLBACK = 'I can help with how TicketForge works (projects, issues, board, versions, export, roles) and with ticket counts for your projects. Try “How do I create a project?” or “How many tickets are in my project?”.';

const norm = (s) => ` ${String(s || '').toLowerCase().replace(/[^\w\s'’]/g, ' ').replace(/\s+/g, ' ').trim()} `;

/** The FAQ entry that best matches the question (most keyword hits), or null. */
export function matchFaq(message) {
  const m = norm(message);
  let best = null, score = 0;
  for (const e of FAQ) {
    const s = e.k.reduce((n, k) => n + (m.includes(norm(k)) ? k.length : 0), 0); // whole words; longer phrases weigh more
    if (s > score) { best = e; score = s; }
  }
  return best;
}

const TICKET_WORD = /\b(tickets?|issues?|stor(?:y|ies)|bugs?|tasks?|backlog)\b/;
const DATA_WORD = /\b(how many|count|number of|total|open|unresolved|assigned|my|mine|in progress|to do|todo|done|closed|status|list|show|overview|summary)\b/;
const HOW_TO = /^\s*(how (do|can|to|should)|where (do|can))\b/;
const PEOPLE = /\b(how many|count|number of|list|who|show|total)\b.*\b(users?|members|people|accounts|colleagues)\b|\b(users?|members|people|accounts)\b.*\b(count|total|list)\b/;

const tell = (reply, kind) => ({ reply, kind });

const doneNames = (workflow) => new Set(workflow?.length ? workflow.filter((w) => w.category === 'done').map((w) => w.name) : ['Done']);

/** Counts for one project the person can read (the database also filters by their access). */
async function projectStats(project, user) {
  const meta = (await q('select data from projects where id = $1', [project.id])).rows[0]?.data || {};
  const rows = (await q('select data from issues where project_id = $1 and not is_sub', [project.id])).rows;
  const done = doneNames(meta.workflow);
  const byStatus: Map<any, any> = new Map();
  let open = 0, mine = 0;
  for (const { data: t } of rows) {
    const st = t.status || 'To Do';
    byStatus.set(st, (byStatus.get(st) || 0) + 1);
    if (!done.has(st)) open++;
    if (t.assignee && t.assignee === user.name) mine++;
  }
  return { name: project.name, total: rows.length, open, mine, byStatus: [...byStatus] };
}

const describe = (s, askedMine) => {
  const parts = s.byStatus.map(([k, n]) => `${k}: ${n}`).join(', ');
  return `${s.name} has ${s.total} ticket${s.total === 1 ? '' : 's'}: ${s.open} open and ${s.total - s.open} done${parts ? ` (${parts})` : ''}.${askedMine ? ` ${s.mine} ${s.mine === 1 ? 'is' : 'are'} assigned to you.` : ''}`;
};

/** Ticket data, only for the projects this person can access. */
async function ticketAnswer(user, text) {
  const m = norm(text);
  // Every project name in the workspace is compared with the question (names only, never data) so a project the person
  // can't open is refused instead of being treated as "not found".
  const all = (await qs('select id, name, key from projects where workspace_id = $1', [user.workspace_id || ''])).rows;
  const keyOf = (p) => String(p.key || '').toLowerCase().replace(/[^\w]/g, '');
  const named = all.filter((p) => (p.name && m.includes(norm(p.name))) || (keyOf(p) && new RegExp(`\\b${keyOf(p)}\\b`).test(m)));
  const denied = named.filter((p) => !canAccess(user, p.id));
  const allowed = named.filter((p) => canAccess(user, p.id));
  if (denied.length && !allowed.length) return tell('You don’t have access to that project, so I can’t share its tickets. Ask an administrator to add you to it.', 'denied');
  const mine = /\b(my|mine|assigned to me)\b/.test(m);
  const pool = allowed.length ? allowed : all.filter((p) => canAccess(user, p.id));
  if (!pool.length) return tell('You don’t have access to any project yet, so there is no ticket data I can show. Ask an administrator to add you to a project.', 'denied');
  if (pool.length > 8) return tell(`You have access to ${pool.length} projects. Name one (for example “How many tickets are in ${pool[0].name}?”).`, 'data');
  const lines: any[] = [];
  for (const p of pool) lines.push(describe(await projectStats(p, user), mine));
  return tell(lines.join('\n'), 'data');
}

/** People counts need the "Manage users and access" permission. */
async function peopleAnswer(user) {
  if (!has(user, 'users.manage')) return tell('You don’t have permission to see user information, so I can’t answer that. Ask an administrator.', 'denied');
  const n = (await qs('select count(*)::int n from workspace_members where workspace_id = $1', [user.workspace_id || ''])).rows[0]?.n || 0;
  return tell(`There ${n === 1 ? 'is' : 'are'} ${n} ${n === 1 ? 'person' : 'people'} in this workspace.`, 'data');
}

/**
 * Answers one question for a signed-in user. Returns { reply, kind } where kind is 'faq', 'data', 'denied' or 'unknown'.
 * Order: people data (permission checked) → ticket data (access checked) → FAQ → fallback.
 */
export async function answer(user, message) {
  const text = String(message || '').trim().slice(0, 500);
  if (!text) return tell('Type a question and I’ll do my best to help.', 'unknown');
  const m = norm(text);
  if (PEOPLE.test(m) && !HOW_TO.test(text)) return peopleAnswer(user);
  if (TICKET_WORD.test(m) && DATA_WORD.test(m) && !HOW_TO.test(text)) return ticketAnswer(user, text);
  const faq = matchFaq(text);
  if (faq) return tell(faq.a, 'faq');
  return tell(FALLBACK, 'unknown');
}

const on = (v) => /^(1|true|on|yes)$/i.test(String(v || '').trim());
/**
 * The release announcement (the robot). Off unless RELEASE_ANNOUNCEMENT is set to 1/true/on.
 * RELEASE_ANNOUNCEMENT_MESSAGE overrides `fallback`, the message built from the latest release.
 */
export function announcement(fallback) {
  if (!on(process.env.RELEASE_ANNOUNCEMENT)) return null;
  const message = String(process.env.RELEASE_ANNOUNCEMENT_MESSAGE || fallback || '').trim().slice(0, 300);
  if (!message) return null;
  let h = 0;
  for (const c of message) h = (h * 31 + c.charCodeAt(0)) | 0;
  return { id: `r${(h >>> 0).toString(36)}`, message };
}
