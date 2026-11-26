// The Ticket Forge layout of a GitHub issue body, like a Jira ticket: a summary line (type,
// priority, points, epic, key), the user story, the description, the acceptance criteria as
// Given / When / Then, the ticket's pull requests (links) and the test cases. Earlier versions of
// Ticket Forge filed issues with this body; the connection is import-only now, so nothing files
// them any more, but those issues still exist on GitHub.
// The import (lib/github-sync.ts) maps the body to the ticket's description, so the description
// sits between hidden markers: descriptionOf() reads just that part back, and the rest of the
// layout never leaks into the ticket. A body without the markers (an issue written on GitHub) is
// the description as a whole. ticketBody() writes the layout (the tests use it to make such bodies).

const OPEN = '<!-- tf:description -->';
const CLOSE = '<!-- /tf:description -->';
const BODY_MAX = 60000;
const LIST_MAX = 30;

export type TicketForBody = {
  title?: string;
  description?: string;
  userStory?: string;
  acceptanceCriteria?: string[];
  testCases?: { title?: string; type?: string; steps?: string[]; expected?: string }[];
  type?: string;
  priority?: string;
  storyPoints?: number | null;
  key?: string;
  prs?: { number?: number; title?: string; url?: string; status?: string; repo?: string }[];
};

const text = (v: any) =>
  String(v ?? '')
    .replace(/\r\n/g, '\n')
    .trim();
const KEYWORD = /^(given|when|then|and|but)\b\s*/i;
const cap = (w: string) => w[0].toUpperCase() + w.slice(1).toLowerCase();

/** One criterion as Jira-style lines: "Given …, when …, then …" → **Given** … / **When** … / … */
export function gwtLines(criterion: string) {
  const s = text(criterion);
  if (!/^given\b/i.test(s)) return [`- ${s}`];
  return s
    .split(/\s*[,;]\s*(?=(?:when|then|and|but)\b)|\s+(?=(?:when|then)\b)/i)
    .map((part) => `- ${part.replace(KEYWORD, (_m, k) => `**${cap(k)}** `)}`);
}

function summaryLine(t: TicketForBody, epic: string) {
  const parts = [
    `**${text(t.type) || 'Story'}**`,
    t.priority && `Priority: **${text(t.priority)}**`,
    t.storyPoints && `Story points: **${t.storyPoints}**`,
    epic && `Epic: **${epic}**`,
    t.key && `Ticket Forge: **${text(t.key)}**`,
  ];
  return `> ${parts.filter(Boolean).join(' · ')}`;
}

function criteria(list: string[]) {
  return list
    .slice(0, LIST_MAX)
    .map((c, i) => [`**AC${i + 1}**`, ...gwtLines(c)].join('\n'))
    .join('\n\n');
}

function testCases(list: TicketForBody['testCases'] = []) {
  return list
    .slice(0, LIST_MAX)
    .map((tc, i) => {
      const steps = (tc.steps || []).map((s, n) => `   ${n + 1}. ${text(s)}`).join('\n');
      const expected = text(tc.expected) && `   - Expected: ${text(tc.expected)}`;
      const head = `${i + 1}. **${text(tc.title) || 'Test'}**${tc.type ? ` _(${text(tc.type)})_` : ''}`;
      return [head, steps, expected].filter(Boolean).join('\n');
    })
    .join('\n');
}

/** The ticket's pull requests: "#19 TF-71: Version tickets… (Merged)", each a link. */
function pullRequests(list: TicketForBody['prs'] = []) {
  return list
    .filter((p) => p?.url)
    .slice(0, LIST_MAX)
    .map((p) => {
      const label = `${p.number ? `#${p.number} ` : ''}${text(p.title) || 'Pull request'}`;
      return `- [${label.replace(/[[\]]/g, '')}](${p.url})${p.status ? ` · ${text(p.status)}` : ''}`;
    })
    .join('\n');
}

/** The GitHub issue body for a ticket. `epic`: the title of the ticket's epic ('' for none). */
export function ticketBody(t: TicketForBody, epic = '') {
  const ac = (t.acceptanceCriteria || []).map(text).filter(Boolean);
  const sections = [
    summaryLine(t, text(epic)),
    text(t.userStory) && `### User story\n${text(t.userStory)}`,
    `### Description\n${OPEN}\n${text(t.description)}\n${CLOSE}`,
    ac.length && `### Acceptance criteria\n${criteria(ac)}`,
    t.prs?.some((p) => p?.url) && `### Pull requests\n${pullRequests(t.prs)}`,
    t.testCases?.length && `### Test cases\n${testCases(t.testCases)}`,
  ];
  return sections.filter(Boolean).join('\n\n').slice(0, BODY_MAX);
}

/** True when the body was laid out by ticketBody (it has the description markers). */
export const isTicketBody = (body: any) => text(body).includes(OPEN) && text(body).includes(CLOSE);

/** The ticket description in a GitHub issue body: the marked part, else the whole body. */
export function descriptionOf(body: any) {
  const s = text(body);
  const a = s.indexOf(OPEN);
  const b = s.indexOf(CLOSE, a + OPEN.length);
  return a >= 0 && b >= 0 ? text(s.slice(a + OPEN.length, b)) : s;
}
