// What Ticket Forge AI knows when it answers: how the app works (the help FAQ), who is asking, the
// open project's epics and issues, and live counts for data questions. Only what this person may
// see: the project was access-checked before, and the counts come from the rule-based helper, which
// checks access and permissions itself.
import { FAQ, answer as ruleAnswer } from '../chatbot';
import { has } from '../store';

const ISSUES_MAX = 300;
const PROJECT_TEXT_MAX = 24000;

export const appGuide = () => FAQ.map((e) => `- ${e.a}`).join('\n');

export function personBlock(user) {
  const can = [
    has(user, 'issue.create') && 'create issues',
    has(user, 'issue.edit') && 'edit issues',
    has(user, 'users.manage') && 'manage users',
  ].filter(Boolean);
  const name = user?.name || 'a team member';
  const role = user?.role_name ? ` Their role is ${user.role_name}.` : '';
  const owner = user?.is_owner ? ' They own this workspace.' : '';
  const rights = can.length
    ? `They can ${can.join(', ')}.`
    : 'They can view issues but not change them.';
  return `The person asking is ${name}.${role}${owner} ${rights}`;
}

/** One issue as a short line: key | type | status | priority | points | assignee | epic | title. */
function issueLine(t, epicTitle: (id: string) => string) {
  return [
    t.key,
    t.type,
    t.status || 'To Do',
    t.priority,
    t.storyPoints ? `${t.storyPoints} pts` : '',
    t.assignee ? `@${t.assignee}` : 'unassigned',
    epicTitle(t.epicId),
    t.title,
  ]
    .filter(Boolean)
    .join(' | ');
}

/** The open project: its workflow, epics and issues (the first ISSUES_MAX), kept to a size. */
export function projectBlock(project) {
  const epics = project.epics || [];
  const titleOf = new Map<string, string>(epics.map((e) => [e.id, `epic: ${e.title}`]));
  const tickets = project.tickets || [];
  const lines = tickets
    .slice(0, ISSUES_MAX)
    .map((t) => issueLine(t, (id) => titleOf.get(id) || ''));
  const more = tickets.length - lines.length;
  const statuses = (project.workflow || []).map((w) => w.name).join(' → ');
  return [
    `The open project is ${project.name} (key ${project.key}) with ${tickets.length} issues.`,
    statuses && `Workflow: ${statuses}.`,
    epics.length && `Epics:\n${epics.map((e) => `- ${e.title}`).join('\n')}`,
    lines.length &&
      `Issues (key | type | status | priority | points | assignee | epic | title):\n${lines.join('\n')}`,
    more > 0 && `(${more} more issues are not listed.)`,
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, PROJECT_TEXT_MAX);
}

/** Live ticket or people counts when the question asks for them ('' otherwise). */
export async function liveFacts(user, message: string) {
  try {
    const r = await ruleAnswer(user, message);
    return r.kind === 'data' || r.kind === 'denied' ? r.reply : '';
  } catch {
    return '';
  }
}

/** The free, rule-based answer, used when no AI is set up. */
export const basicAnswer = async (user, message: string) => (await ruleAnswer(user, message)).reply;
