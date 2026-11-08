import { standardsBlock } from './genrules.js';

export const SYSTEM_BA = `You are a senior business analyst, product owner and QA lead.
You turn requirement documents into a clean, delivery-ready backlog: epics that segregate the work by
capability, well-scoped tickets (user stories, tasks, spikes, bugs), testable acceptance criteria in
the agreed form, and focused test cases.
Rules:
- Stay faithful to the document. Do not invent features. When something is unclear, record it as an
  open question or assumption instead of guessing.
- Each ticket must be small enough for one sprint.
- Acceptance criteria must be specific, observable and testable.
- Always reply with a single valid JSON value and nothing else: no prose, no markdown fences.`;

/** The system prompt plus the team's generation standards (Administration → Generation). */
export const systemWith = (rules, parts) => `${SYSTEM_BA}

${standardsBlock(rules, parts)}`;

const TICKET_SHAPE = `{
  "title": "short imperative summary",
  "type": "Story | Task | Spike | Bug",
  "priority": "Highest | High | Medium | Low",
  "storyPoints": 3,
  "labels": ["frontend"],
  "userStory": "As a <role>, I want <capability>, so that <benefit>.",
  "description": "context, scope, notes for developers (plain text, may use - bullets)",
  "acceptanceCriteria": ["Given ..., when ..., then ..."],
  "dependencies": ["title of another ticket this depends on"]
}`;

const TEST_CASE_SHAPE = `{
  "title": "what is verified",
  "type": "Functional | Negative | Edge | UI | Integration | Security | Performance | Accessibility",
  "priority": "High | Medium | Low",
  "preconditions": "state before the test",
  "steps": ["step 1", "step 2"],
  "expected": "expected result",
  "acRef": [1]
}`;

export function backlogPrompt({ text, sourceName, options }) {
  const granularity = {
    coarse: 'Prefer fewer, larger tickets (still sprint-sized).',
    balanced: 'Use a balanced granularity.',
    fine: 'Prefer many small, very focused tickets.',
  }[options.granularity || 'balanced'];
  return `Read the requirements document below and produce a backlog.

${granularity}
${options.instructions ? `Additional instructions from the user:\n${options.instructions}\n` : ''}
Return JSON with exactly this shape:
{
  "projectName": "name of the product/project",
  "summary": "3-5 sentence summary of what the document asks for",
  "assumptions": ["..."],
  "openQuestions": ["questions to raise with stakeholders"],
  "epics": [
    {
      "title": "Epic name",
      "description": "what this epic covers and its business goal",
      "tickets": [ ${TICKET_SHAPE} ]
    }
  ]
}
Do not include test cases yet.

Document name: ${sourceName || 'untitled'}
<document>
${text}
</document>`;
}

export function testCasesPrompt({ epic, tickets, summary, perTicket }) {
  const list = tickets.map((t, i) => ({
    index: i,
    title: t.title,
    userStory: t.userStory,
    description: t.description,
    acceptanceCriteria: t.acceptanceCriteria,
  }));
  return `Project summary: ${summary || 'n/a'}
Epic: ${epic.title} - ${epic.description || ''}

Write exactly ${perTicket} test case${perTicket === 1 ? '' : 's'} for each ticket below, following the team standards.
"acRef" lists the 1-based acceptance-criteria numbers each test covers.

Tickets:
${JSON.stringify(list, null, 2)}

Return JSON: { "tickets": [ { "index": 0, "testCases": [ ${TEST_CASE_SHAPE} ] } ] }`;
}

export function ticketActionPrompt({ action, ticket, epic, project, instruction }) {
  const ctx = `Project: ${project?.name || ''}
Project summary: ${project?.summary || ''}
Epic: ${epic?.title || 'none'} - ${epic?.description || ''}

Current ticket (JSON):
${JSON.stringify(stripIds(ticket), null, 2)}`;

  const tasks = {
    enhance: `Bring this ticket up to the team standards: sharpen the title, complete the user story and description,
and make the acceptance criteria complete and testable. Keep the intent. Update the test cases so every acceptance
criterion is covered.`,
    ac: `Rewrite the acceptance criteria only, following the team standards. Leave the other fields unchanged.`,
    tests: `Regenerate the test cases only, following the team standards. Leave the other fields unchanged.`,
    custom: `Apply this instruction from the user to the ticket: "${instruction}". Change only what the instruction requires.`,
  };

  if (action === 'split') {
    return `${ctx}

This ticket is too large. Split it into 2-5 smaller, independently deliverable tickets that together cover the same scope.
Each needs its own user story, acceptance criteria and test cases.
Return JSON: { "tickets": [ ${TICKET_SHAPE.replace(/\n}$/, `,\n  "testCases": [ ${TEST_CASE_SHAPE} ]\n}`)} ] }`;
  }

  return `${ctx}

${tasks[action] || tasks.enhance}
Return the full updated ticket as JSON with this shape (include every field):
${TICKET_SHAPE.replace(/\n}$/, `,\n  "testCases": [ ${TEST_CASE_SHAPE} ]\n}`)}`;
}

export function newTicketPrompt({ epic, project, idea }) {
  return `Project: ${project?.name || ''}
Project summary: ${project?.summary || ''}
Epic: ${epic?.title || 'none'} - ${epic?.description || ''}
Existing tickets in this epic: ${(project?.tickets || []).filter((t) => t.epicId === epic?.id).map((t) => t.title).join('; ') || 'none'}

Write one new ticket for this idea: "${idea}". Include acceptance criteria and test cases.
Return JSON with this shape:
${TICKET_SHAPE.replace(/\n}$/, `,\n  "testCases": [ ${TEST_CASE_SHAPE} ]\n}`)}`;
}

export function regroupPrompt({ project, instruction }) {
  const tickets = project.tickets.map((t) => ({ id: t.id, title: t.title, userStory: t.userStory, currentEpic: project.epics.find((e) => e.id === t.epicId)?.title }));
  return `Project summary: ${project.summary || ''}
${instruction ? `User instruction: ${instruction}\n` : ''}
Re-organise these tickets into a clean set of epics that segregate the work by business capability.
You may rename, merge or create epics. Every ticket id must appear in exactly one epic.

Tickets:
${JSON.stringify(tickets, null, 2)}

Return JSON: { "epics": [ { "title": "...", "description": "...", "ticketIds": ["..."] } ] }`;
}

function stripIds(t) {
  const { id, key, epicId, ...rest } = t;
  return { ...rest, testCases: (t.testCases || []).map(({ id: _i, key: _k, ...tc }) => tc) };
}
