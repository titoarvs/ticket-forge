import { askJson } from './claude.js';
import { SYSTEM_BA, systemWith, backlogPrompt, featurePrompt, testCasesPrompt, ticketActionPrompt, newTicketPrompt, regroupPrompt } from './prompts.js';
import { getRules, getGuide, applyTicketRules, applyTestRules, capTests } from './genrules.js';
import { agentInstructions } from './agents.js';
import { buildProject, normTestCase, normTicket, assignKeys, uid } from './model.js';

/** Full pipeline: document -> epics/tickets/AC -> test cases per epic. emit({stage, message, ...}) */
export async function generateProject({ text, sourceName, options = {}, emit = () => {}, signal }) {
  // When a provider is limited and TicketForge switches to the next one, say so in the progress log.
  // The team's standards (Administration → Generation); a run can ask for a different number of tests per ticket.
  const base = await getRules();
  const perTicket = Number(options.testsPerTicket) || base.tests.perTicket;
  const rules = { ...base, tests: { ...base.tests, perTicket } };
  const guide = await getGuide();
  const ai = { provider: options.provider, model: options.model, signal, reasoning: rules.reasoning, onSwitch: (message) => emit({ stage: 'info', level: 'warn', message }) };
  emit({ stage: 'backlog', message: 'Reading the document and drafting epics & tickets…' });
  let lastTick = 0;
  const raw = await askJson({task: 'epics', 
    ...ai,
    system: systemWith(rules, ['tickets'], guide) + await agentInstructions('working-tickets'),
    prompt: backlogPrompt({ text, sourceName, options }),
    onText: (_n, total) => { if (total - lastTick > 400) { lastTick = total; emit({ stage: 'backlog', progressChars: total }); } },
  });
  const project = buildProject(raw, { key: options.projectKey, sourceName, sourceText: text });
  project.tickets = project.tickets.map((t) => applyTicketRules(t, rules));
  emit({ stage: 'backlog-done', message: `Drafted ${project.epics.length} epics and ${project.tickets.length} tickets.`, project });

  if (options.includeTests !== false && project.tickets.length) {
    await writeTestCases({ epics: project.epics, tickets: project.tickets, summary: project.summary, rules, guide, ai, emit, signal });
  }
  assignKeys(project);
  return project;
}

/** Writes test cases for the tickets, one AI request per epic, a few at a time. */
async function writeTestCases({ epics, tickets: all, summary, rules, guide, ai, emit, signal }) {
  const perTicket = rules.tests.perTicket;
  const groups = epics.map((epic) => ({ epic, tickets: all.filter((t) => t.epicId === epic.id) })).filter((g) => g.tickets.length);
  let done = 0;
  const jobs = groups.map(({ epic, tickets }) => async () => {
    try {
      const res = await askJson({ ...ai, task: 'tests', system: systemWith(rules, ['tests'], guide) + await agentInstructions('test-plan'), prompt: testCasesPrompt({ epic, tickets, summary, perTicket }) });
      for (const item of res.tickets || []) {
        const t = tickets[Number(item.index)];
        if (t) t.testCases = capTests(item.testCases, rules).map(normTestCase).map((tc) => applyTestRules(tc, rules));
      }
      done += 1;
      emit({ stage: 'tests', message: `Test cases ready for “${epic.title}” (${done}/${groups.length})` });
    } catch (err) {
      if (signal?.aborted) throw err;
      done += 1;
      emit({ stage: 'tests', level: 'warn', message: `Could not write test cases for “${epic.title}”: ${err.message}. You can generate them per ticket later.` });
    }
  });
  emit({ stage: 'tests', message: `Writing test cases for ${groups.length} epic${groups.length === 1 ? '' : 's'}…` });
  await runPool(jobs, Number(process.env.TICKETFORGE_CONCURRENCY) || 3);
}

/**
 * New work for an existing project from a description or document: new or existing epics with tickets (and test
 * cases). Nothing is saved here; the person reviews the result and adds what they want.
 */
export async function extendProject({ project, text, sourceName, options = {}, emit = () => {}, signal }) {
  const base = await getRules();
  const perTicket = Number(options.testsPerTicket) || base.tests.perTicket;
  const rules = { ...base, tests: { ...base.tests, perTicket } };
  const guide = await getGuide();
  const ai = { provider: options.provider, model: options.model, signal, reasoning: rules.reasoning, onSwitch: (message) => emit({ stage: 'info', level: 'warn', message }) };
  emit({ stage: 'feature', message: `Reading “${sourceName || 'the description'}” and planning the new work…` });
  let lastTick = 0;
  const raw = await askJson({task: 'epics', 
    ...ai,
    system: systemWith(rules, ['tickets'], guide) + await agentInstructions('working-tickets'),
    prompt: featurePrompt({ text, sourceName, project, options }),
    onText: (_n, total) => { if (total - lastTick > 400) { lastTick = total; emit({ stage: 'feature', progressChars: total }); } },
  });
  const norm = (s) => String(s || '').trim().toLowerCase();
  const existing = new Map((project.epics || []).map((e) => [norm(e.title), e]));
  const epics = [];
  const tickets = [];
  for (const e of raw.epics || []) {
    const match = existing.get(norm(e.title));
    let epic = epics.find((x) => norm(x.title) === norm(match ? match.title : e.title));
    if (!epic) {
      epic = match ? { id: match.id, title: match.title, description: match.description || '', existing: true }
        : { id: uid(), title: String(e.title || 'New epic').trim(), description: String(e.description || '').trim(), existing: false };
      epics.push(epic);
    }
    for (const t of e.tickets || []) tickets.push(applyTicketRules(normTicket({ ...t, id: uid() }, epic.id), rules));
  }
  emit({ stage: 'feature-done', message: `Planned ${tickets.length} new issue${tickets.length === 1 ? '' : 's'} in ${epics.length} epic${epics.length === 1 ? '' : 's'} (${epics.filter((x) => !x.existing).length} new).` });
  if (options.includeTests !== false && tickets.length) {
    await writeTestCases({ epics, tickets, summary: project.summary, rules, guide, ai, emit, signal });
  }
  return { summary: String(raw.summary || ''), openQuestions: (raw.openQuestions || []).map(String), epics, tickets };
}

async function runPool(jobs, size) {
  const queue = [...jobs];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await queue.shift()();
  }));
}

/** A ticket from the AI, normalized and brought to the team standards. */
const standard = (t, epicId, rules) => {
  const n = normTicket(t, epicId);
  return applyTicketRules({ ...n, testCases: capTests(n.testCases, rules) }, rules);
};

export async function ticketAction({ action, ticket, project, instruction, answers = '', ai }) {
  const rules = await getRules();
  const epic = project?.epics?.find((e) => e.id === ticket.epicId);
  const res = await askJson({ ...ai, task: action === 'tests' ? 'tests' : 'tickets', reasoning: rules.reasoning, system: systemWith(rules, ['tickets', 'tests'], await getGuide()) + await agentInstructions(action === 'tests' ? 'test-plan' : 'working-tickets'), prompt: ticketActionPrompt({ action, ticket, epic, project, instruction, answers: String(answers || '').slice(0, 4000) }) });
  if (action === 'split') {
    return { tickets: (res.tickets || []).map((t) => standard({ ...t, id: uid() }, ticket.epicId, rules)) };
  }
  const updated = standard({ ...res, id: ticket.id, key: ticket.key, status: ticket.status, assignee: ticket.assignee }, ticket.epicId, rules);
  if (action === 'ac') { return { ticket: { ...ticket, acceptanceCriteria: updated.acceptanceCriteria } }; }
  if (action === 'tests') { return { ticket: { ...ticket, testCases: updated.testCases } }; }
  return { ticket: updated };
}

export async function newTicket({ epicId, project, idea, answers = '', ai }) {
  const epic = project.epics.find((e) => e.id === epicId);
  const rules = await getRules();
  const res = await askJson({ ...ai, task: 'tickets', reasoning: rules.reasoning, system: systemWith(rules, ['tickets', 'tests'], await getGuide()) + await agentInstructions('working-tickets'), prompt: newTicketPrompt({ epic, project, idea, answers: String(answers || '').slice(0, 4000) }) });
  return { ticket: standard(res, epicId, rules) };
}

export async function regroupEpics({ project, instruction, ai }) {
  const rules = await getRules();
  const res = await askJson({ ...ai, task: 'epics', reasoning: rules.reasoning, system: SYSTEM_BA, prompt: regroupPrompt({ project, instruction }) });
  return { epics: (res.epics || []).map((e) => ({ title: String(e.title || 'Epic'), description: String(e.description || ''), ticketIds: (e.ticketIds || []).map(String) })) };
}
