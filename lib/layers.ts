// Frontend, backend or both: where an issue's implementation lives, for projects whose backend is a separate
// repository. The AI reads each issue (and the two repositories' names and conventions) and decides.
import { askJson } from './claude';
import { jevEnabled, jevStatus, jevDecide } from './jev';

export const LAYERS = ['frontend', 'backend', 'both'];
const clip = (s, n) => {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** Returns { layers: { [ticketId]: 'frontend' | 'backend' | 'both' }, reasons: { [ticketId]: string } }. */
export async function classifyLayers({ project, onlyMissing = true, ai = {} }: any) {
  const all = project.tickets.filter((t) => !t.parentId && (!onlyMissing || !LAYERS.includes(t.layer)));
  const fe = project.dev || {},
    be = project.devBackend || {};
  const layers = {},
    reasons = {};
  // Jev (Administration → AI → Decisions) answers first, in one quick call per 25 issues; what it isn't sure about, or
  // can't answer, goes to the AI below.
  let tickets = all,
    byJev = 0;
  if (await jevEnabled().catch(() => false)) {
    const min = (await jevStatus()).minConfidence;
    const rest: any[] = [];
    for (let i = 0; i < all.length; i += 25) {
      const chunk = all.slice(i, i + 25);
      const name = (t) => String(t.key || t.id);
      try {
        const r = await jevDecide({
          state: {
            project: project.name,
            frontendRepository: `${fe.repo || fe.localPath || 'n/a'}${fe.notes ? ` — ${clip(fe.notes, 400)}` : ''}`,
            backendRepository: `${be.repo || be.localPath || 'n/a'}${be.notes ? ` — ${clip(be.notes, 400)}` : ''}`,
            issues: Object.fromEntries(
              chunk.map((t) => [
                name(t),
                {
                  type: t.type,
                  title: t.title,
                  userStory: clip(t.userStory, 200),
                  description: clip(t.description, 300),
                  acceptanceCriteria: (t.acceptanceCriteria || []).slice(0, 4).map((a) => clip(a, 120)),
                },
              ]),
            ),
          },
          questions: Object.fromEntries(
            chunk.map((t) => [
              name(t),
              {
                type: 'choice' as const,
                instructions: `Where does the implementation of issue ${name(t)} live? Spikes, documentation and confirmation tasks that change no code go to the side whose code they inform most.`,
                criteria: {
                  frontend:
                    'only the user interface changes: pages, components, forms, client-side validation; the API it needs already exists or isn’t needed',
                  backend:
                    'only server-side work: APIs, data, business rules, permissions, integrations, background jobs; no new screen or UI change',
                  both: 'new or changed data/API AND a screen or UI change',
                },
              },
            ]),
          ),
        });
        for (const t of chunk) {
          const a: any = r.answers[name(t)];
          if (a?.choice && LAYERS.includes(a.choice) && (a.confidence ?? 0) >= min) {
            layers[t.id] = a.choice;
            reasons[t.id] = `Jev: ${a.choice}, ${Math.round((a.confidence ?? 0) * 100)}% sure`;
            byJev++;
          } else rest.push(t);
        }
      } catch {
        rest.push(...chunk);
      }
    }
    tickets = rest;
  }
  for (let i = 0; i < tickets.length; i += 50) {
    const batch = tickets.slice(i, i + 50);
    const res = await askJson({
      ...ai,
      task: 'quick',
      reasoning: 'fast',
      system: `You are a tech lead splitting work between a FRONTEND repository (user interface: pages, components, forms, client-side
validation, calling APIs) and a separate BACKEND repository (APIs, database, business rules and computations, permissions enforced on
the server, integrations, background jobs, emails). Decide where each issue's implementation lives:
- "frontend": only the interface changes; the API it needs already exists or isn't needed.
- "backend": only server-side work (computation, data, integration, scheduled job) with no new screen or UI change.
- "both": new or changed data/API AND a screen or UI change.
Spikes, documentation and confirmation tasks that change no code: pick the side whose code they inform most.
Return JSON only: { "items": [ { "key": "PR-1", "layer": "frontend|backend|both", "why": "one short reason" } ] }`,
      prompt: `Project: ${project.name}
Frontend repository: ${fe.repo || fe.localPath || 'n/a'}${fe.notes ? ` — ${clip(fe.notes, 400)}` : ''}
Backend repository: ${be.repo || be.localPath || 'n/a'}${be.notes ? ` — ${clip(be.notes, 400)}` : ''}

Issues:
${batch
  .map(
    (t) =>
      `- ${t.key} [${t.type}] ${t.title}${t.userStory ? ` | ${clip(t.userStory, 200)}` : ''}${t.description ? ` | ${clip(t.description, 300)}` : ''}${
        t.acceptanceCriteria?.length
          ? ` | AC: ${t.acceptanceCriteria
              .slice(0, 4)
              .map((a) => clip(a, 120))
              .join(' / ')}`
          : ''
      }`,
  )
  .join('\n')}`,
    });
    const byKey = new Map(batch.map((t) => [t.key, t]));
    for (const it of res.items || []) {
      const t: any = byKey.get(String(it.key));
      if (t && LAYERS.includes(it.layer)) {
        layers[t.id] = it.layer;
        reasons[t.id] = clip(it.why, 200);
      }
    }
  }
  return { layers, reasons, count: all.length, byJev };
}
