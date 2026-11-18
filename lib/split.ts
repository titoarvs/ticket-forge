// Splitting existing issues into smaller ones, many at a time (Epics page / epic panel). For each issue the AI either
// keeps it (already small, with a reason) or splits it into 2–5 small, independently testable tickets sized on the team's
// point scale, and says which of the issue's test cases belong to which new ticket. Nothing is saved here.
import { askJson } from './claude';
import { systemWith } from './prompts';
import { getRules, getGuide, applyTicketRules } from './genrules';
import { normTicket } from './model';
import { agentInstructions } from './agents';
import { contextBlock } from './appcontext';

const clip = (s, n) => {
  const t = String(s ?? '').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** Returns { results: [{ ticketId, key, action: 'split' | 'keep' | 'error', reason, parts: [{ ...ticket, testCaseIds }] }] }. */
export async function splitIssues({ project, ticketIds, instruction = '', ai = {}, emit = (_e) => {} }: any) {
  const rules = await getRules();
  const R = rules.tickets || {};
  const scale = R.pointScale?.length ? R.pointScale : [1, 2, 3, 5, 8, 13];
  const small = scale.filter((x) => x <= 3);
  const maxPts = Math.min(5, R.maxPoints || 5);
  const acRange = R.acMin ? `${R.acMin}–${R.acMax || R.acMin}` : '3–5';
  const system = systemWith(rules, ['tickets'], await getGuide()) + (await agentInstructions('working-tickets')) + contextBlock(project);
  const tickets = ticketIds.map((id) => project.tickets.find((t) => t.id === id)).filter(Boolean);
  const results: any[] = [];
  let done = 0;
  const queue = [...tickets];
  const worker = async () => {
    while (queue.length) {
      if (ai.signal?.aborted) return;
      const t = queue.shift();
      emit({ type: 'progress', message: `Splitting ${t.key}: ${t.title}`, done, total: tickets.length });
      const epic = project.epics.find((e) => e.id === t.epicId);
      const siblings = project.tickets
        .filter((x) => x.epicId === t.epicId && x.id !== t.id)
        .slice(0, 40)
        .map((x) => `${x.key} ${x.title}`)
        .join('\n');
      try {
        const res = await askJson({
          ...ai,
          task: 'split',
          reasoning: rules.reasoning,
          system,
          brain: { projectId: project.id, issues: [t], epics: epic ? [epic] : [], max: 5000 },
          prompt: `Split this issue into smaller issues, if it is too big.

PROJECT: ${project.name}
EPIC: ${epic ? `${epic.key} ${epic.title}` : 'none'}
OTHER ISSUES IN THE EPIC (don't duplicate them):
${siblings || '- none'}

THE ISSUE ${t.key} [${t.type}, ${t.status}${t.storyPoints != null ? `, ${t.storyPoints} pts` : ', not estimated'}]: ${t.title}
User story: ${clip(t.userStory, 800) || 'n/a'}
Description: ${clip(t.description, 2500) || 'n/a'}
Acceptance criteria:
${(t.acceptanceCriteria || []).map((a, i) => `AC${i + 1}. ${clip(a, 300)}`).join('\n') || '- none'}
Test cases:
${(t.testCases || []).map((c, i) => `TC${i + 1}. ${clip(c.title, 160)}`).join('\n') || '- none'}
${instruction ? `\nInstructions from the team: ${clip(instruction, 1500)}\n` : ''}
Rules:
- Split when the issue holds more than one independently deliverable, testable behaviour, or is bigger than ${small[small.length - 1] || 3} points.
  Each new issue: one behaviour, ${small.join(', ')} points (${maxPts} at most), its own user story and acceptance criteria
  (${acRange} acceptance criteria each, the team's standard), together covering EXACTLY the original scope: nothing lost, nothing added.
- Keep it as it is when it is already small and focused; say why in one sentence.
- 2–5 parts. The first part is the core of the original issue (it keeps the original key).
- Assign EVERY original test case (TC1…TC${(t.testCases || []).length || 0}) to exactly one part, in that part's "testCases".
Return JSON: { "action": "split" | "keep", "reason": "…", "parts": [ { "title": "…", "type": "Story|Task|Bug|Spike", "storyPoints": 2, "userStory": "…", "description": "…", "acceptanceCriteria": ["…"], "testCases": [1, 3] } ] }`,
        });
        if (res.action !== 'split' || !Array.isArray(res.parts) || res.parts.length < 2) {
          results.push({
            ticketId: t.id,
            key: t.key,
            action: 'keep',
            reason: clip(res.reason || 'Already small and focused.', 300),
            parts: [],
          });
        } else {
          const tcs = t.testCases || [];
          const parts = res.parts.slice(0, 5).map((p) => {
            const n = applyTicketRules(normTicket({ ...p, labels: t.labels, layer: t.layer, status: t.status }, t.epicId), rules);
            const sp = Number(p.storyPoints);
            return {
              title: n.title,
              type: n.type,
              storyPoints:
                Number.isFinite(sp) && sp > 0
                  ? Math.min(
                      maxPts,
                      scale.reduce((b, c) => (Math.abs(c - sp) < Math.abs(b - sp) ? c : b), scale[0]),
                    )
                  : null,
              userStory: n.userStory,
              description: n.description,
              acceptanceCriteria: n.acceptanceCriteria,
              testCaseIds: (Array.isArray(p.testCases) ? p.testCases : []).map((x) => tcs[Number(x) - 1]?.id).filter(Boolean),
            };
          });
          // Test cases the AI didn't place: a quick second pass assigns them to the part they test.
          let claimed = new Set(parts.flatMap((p) => p.testCaseIds));
          const loose = tcs.map((c, i) => ({ c, i })).filter(({ c }: any) => !claimed.has(c.id));
          if (loose.length && parts.length > 1) {
            try {
              const a = await askJson({
                ...ai,
                task: 'quick',
                reasoning: 'fast',
                system: 'You assign test cases to the issue they test. Return JSON only.',
                prompt: `Issues:
${parts
  .map(
    (p, i) =>
      `P${i + 1}. ${p.title} — ${p.acceptanceCriteria
        .slice(0, 4)
        .map((x) => clip(x, 120))
        .join(' | ')}`,
  )
  .join('\n')}

Test cases:
${loose.map(({ c, i }: any) => `TC${i + 1}. ${clip(c.title, 160)}`).join('\n')}

Put each test case under the one issue it tests. Return JSON: { "assign": [ { "tc": 1, "part": 2 } ] }`,
              });
              for (const x of a.assign || []) {
                const c = tcs[Number(x.tc) - 1];
                const part = parts[Number(x.part) - 1];
                if (c && part && !claimed.has(c.id)) {
                  part.testCaseIds.push(c.id);
                  claimed.add(c.id);
                }
              }
            } catch {
              /* the rest stay with the first part */
            }
          }
          claimed = new Set(parts.flatMap((p) => p.testCaseIds));
          parts[0].testCaseIds.push(...tcs.filter((c) => !claimed.has(c.id)).map((c) => c.id));
          for (let i = 1; i < parts.length; i++)
            parts[i].testCaseIds = parts[i].testCaseIds.filter((id) => !parts.slice(0, i).some((p) => p.testCaseIds.includes(id)));
          results.push({ ticketId: t.id, key: t.key, action: 'split', reason: clip(res.reason || '', 300), parts });
        }
      } catch (e) {
        if (ai.signal?.aborted) return;
        results.push({ ticketId: t.id, key: t.key, action: 'error', reason: clip(e.message, 300), parts: [] });
      }
      done++;
      emit({ type: 'progress', message: `${done} of ${tickets.length} looked at`, done, total: tickets.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, tickets.length) }, worker));
  const order: any = new Map(ticketIds.map((id, i) => [id, i]));
  return { results: results.sort((a, b) => order.get(a.ticketId) - order.get(b.ticketId)) };
}
