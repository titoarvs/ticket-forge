import { askJson } from './claude.js';
import { SYSTEM_BA, systemWith, backlogPrompt, testCasesPrompt, ticketActionPrompt, newTicketPrompt, regroupPrompt } from './prompts.js';
import { getRules, applyTicketRules, applyTestRules, capTests } from './genrules.js';
import { buildProject, normTestCase, normTicket, assignKeys, uid } from './model.js';

/** Full pipeline: document -> epics/tickets/AC -> test cases per epic. emit({stage, message, ...}) */
export async function generateProject({ text, sourceName, options = {}, emit = () => {}, signal }) {
  // When a provider is limited and TicketForge switches to the next one, say so in the progress log.
  // The team's standards (Administration → Generation); a run can ask for a different number of tests per ticket.
  const base = await getRules();
  const perTicket = Number(options.testsPerTicket) || base.tests.perTicket;
  const rules = { ...base, tests: { ...base.tests, perTicket } };
  const ai = { provider: options.provider, model: options.model, signal, reasoning: rules.reasoning, onSwitch: (message) => emit({ stage: 'info', level: 'warn', message }) };
  emit({ stage: 'backlog', message: 'Reading the document and drafting epics & tickets…' });
  let lastTick = 0;
  const raw = await askJson({
    ...ai,
    system: systemWith(rules, ['tickets']),
    prompt: backlogPrompt({ text, sourceName, options }),
    onText: (_n, total) => { if (total - lastTick > 400) { lastTick = total; emit({ stage: 'backlog', progressChars: total }); } },
  });
  const project = buildProject(raw, { key: options.projectKey, sourceName, sourceText: text });
  project.tickets = project.tickets.map((t) => applyTicketRules(t, rules));
  emit({ stage: 'backlog-done', message: `Drafted ${project.epics.length} epics and ${project.tickets.length} tickets.`, project });

  if (options.includeTests !== false && project.tickets.length) {
    let done = 0;
    const jobs = project.epics.map((epic) => async () => {
      const tickets = project.tickets.filter((t) => t.epicId === epic.id);
      if (!tickets.length) return;
      try {
        const res = await askJson({ ...ai, system: systemWith(rules, ['tests']), prompt: testCasesPrompt({ epic, tickets, summary: project.summary, perTicket }) });
        for (const item of res.tickets || []) {
          const t = tickets[Number(item.index)];
          if (t) t.testCases = capTests(item.testCases, rules).map(normTestCase).map((tc) => applyTestRules(tc, rules));
        }
        done += 1;
        emit({ stage: 'tests', message: `Test cases ready for “${epic.title}” (${done}/${project.epics.length})` });
      } catch (err) {
        if (signal?.aborted) throw err;
        done += 1;
        emit({ stage: 'tests', level: 'warn', message: `Could not write test cases for “${epic.title}”: ${err.message}. You can generate them per ticket later.` });
      }
    });
    emit({ stage: 'tests', message: `Writing test cases for ${project.epics.length} epics…` });
    await runPool(jobs, Number(process.env.TICKETFORGE_CONCURRENCY) || 3);
  }
  assignKeys(project);
  return project;
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

export async function ticketAction({ action, ticket, project, instruction, ai }) {
  const rules = await getRules();
  const epic = project?.epics?.find((e) => e.id === ticket.epicId);
  const res = await askJson({ ...ai, reasoning: rules.reasoning, system: systemWith(rules, ['tickets', 'tests']), prompt: ticketActionPrompt({ action, ticket, epic, project, instruction }) });
  if (action === 'split') {
    return { tickets: (res.tickets || []).map((t) => standard({ ...t, id: uid() }, ticket.epicId, rules)) };
  }
  const updated = standard({ ...res, id: ticket.id, key: ticket.key, status: ticket.status, assignee: ticket.assignee }, ticket.epicId, rules);
  if (action === 'ac') { return { ticket: { ...ticket, acceptanceCriteria: updated.acceptanceCriteria } }; }
  if (action === 'tests') { return { ticket: { ...ticket, testCases: updated.testCases } }; }
  return { ticket: updated };
}

export async function newTicket({ epicId, project, idea, ai }) {
  const epic = project.epics.find((e) => e.id === epicId);
  const rules = await getRules();
  const res = await askJson({ ...ai, reasoning: rules.reasoning, system: systemWith(rules, ['tickets', 'tests']), prompt: newTicketPrompt({ epic, project, idea }) });
  return { ticket: standard(res, epicId, rules) };
}

export async function regroupEpics({ project, instruction, ai }) {
  const rules = await getRules();
  const res = await askJson({ ...ai, reasoning: rules.reasoning, system: SYSTEM_BA, prompt: regroupPrompt({ project, instruction }) });
  return { epics: (res.epics || []).map((e) => ({ title: String(e.title || 'Epic'), description: String(e.description || ''), ticketIds: (e.ticketIds || []).map(String) })) };
}
