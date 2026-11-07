import { askJson } from './claude.js';
import { SYSTEM_BA, backlogPrompt, testCasesPrompt, ticketActionPrompt, newTicketPrompt, regroupPrompt } from './prompts.js';
import { buildProject, normTestCase, normTicket, assignKeys, uid } from './model.js';

/** Full pipeline: document -> epics/tickets/AC -> test cases per epic. emit({stage, message, ...}) */
export async function generateProject({ text, sourceName, options = {}, emit = () => {}, signal }) {
  const ai = { provider: options.provider, model: options.model, signal };
  emit({ stage: 'backlog', message: 'Reading the document and drafting epics & tickets…' });
  let lastTick = 0;
  const raw = await askJson({
    ...ai,
    system: SYSTEM_BA,
    prompt: backlogPrompt({ text, sourceName, options }),
    onText: (_n, total) => { if (total - lastTick > 400) { lastTick = total; emit({ stage: 'backlog', progressChars: total }); } },
  });
  const project = buildProject(raw, { key: options.projectKey, sourceName, sourceText: text });
  emit({ stage: 'backlog-done', message: `Drafted ${project.epics.length} epics and ${project.tickets.length} tickets.`, project });

  if (options.includeTests !== false && project.tickets.length) {
    const perTicket = Number(options.testsPerTicket) || 4;
    let done = 0;
    const jobs = project.epics.map((epic) => async () => {
      const tickets = project.tickets.filter((t) => t.epicId === epic.id);
      if (!tickets.length) return;
      try {
        const res = await askJson({ ...ai, system: SYSTEM_BA, prompt: testCasesPrompt({ epic, tickets, summary: project.summary, perTicket }) });
        for (const item of res.tickets || []) {
          const t = tickets[Number(item.index)];
          if (t) t.testCases = (item.testCases || []).map(normTestCase);
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

export async function ticketAction({ action, ticket, project, instruction, ai }) {
  const epic = project?.epics?.find((e) => e.id === ticket.epicId);
  const res = await askJson({ ...ai, system: SYSTEM_BA, prompt: ticketActionPrompt({ action, ticket, epic, project, instruction }) });
  if (action === 'split') {
    return { tickets: (res.tickets || []).map((t) => normTicket({ ...t, id: uid() }, ticket.epicId)) };
  }
  const updated = normTicket({ ...res, id: ticket.id, key: ticket.key, status: ticket.status, assignee: ticket.assignee }, ticket.epicId);
  if (action === 'ac') { return { ticket: { ...ticket, acceptanceCriteria: updated.acceptanceCriteria } }; }
  if (action === 'tests') { return { ticket: { ...ticket, testCases: updated.testCases } }; }
  return { ticket: updated };
}

export async function newTicket({ epicId, project, idea, ai }) {
  const epic = project.epics.find((e) => e.id === epicId);
  const res = await askJson({ ...ai, system: SYSTEM_BA, prompt: newTicketPrompt({ epic, project, idea }) });
  return { ticket: normTicket(res, epicId) };
}

export async function regroupEpics({ project, instruction, ai }) {
  const res = await askJson({ ...ai, system: SYSTEM_BA, prompt: regroupPrompt({ project, instruction }) });
  return { epics: (res.epics || []).map((e) => ({ title: String(e.title || 'Epic'), description: String(e.description || ''), ticketIds: (e.ticketIds || []).map(String) })) };
}
