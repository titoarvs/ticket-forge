import { getMeta, setMeta } from '../appmeta';
import { askAI } from '../claude';
import { wsCache, wsKey } from '../wsmeta';
import { AGENTS } from './agents';
import { MODELS, EFFORTS, CODE_RULES } from './review-lenses';

export const CODE_AGENT_IDS = AGENTS.filter((a) => a.runner === 'code').map((a) => a.id);
// ---------------------------------------------------------------- custom agents (Markdown with frontmatter)
// An administrator describes an agent in plain words and the AI writes its Markdown rules, or pastes / imports a .md
// file in the same format as Claude Code agent files:
//   ---
//   name: Migration Reviewer
//   description: Reviews database migrations for safety
//   runner: review            # code (edits in a worktree) · review (read-only on code) · document (writes a doc for an epic)
//   model: sonnet             # optional: opus · sonnet · haiku
//   effort: medium            # optional: low · medium · high · xhigh · max
//   icon: 🗄️                  # optional
//   ---
//   The agent's instructions in Markdown…
const CUSTOM_RUNNERS = {
  code: { runner: 'code', writes: true, workspace: 'worktree' },
  review: { runner: 'code', writes: false, workspace: 'readonly' },
  'code-readonly': { runner: 'code', writes: false, workspace: 'readonly' },
  document: { runner: 'document', writes: false, workspace: 'documents' },
};
const WRITE_TOOLS = ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'LS', 'TodoWrite'];
const READ_TOOLS = ['Read', 'Glob', 'Grep', 'LS', 'TodoWrite'];
const slug = (x) =>
  String(x || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'agent';
/** Parses an agent .md (frontmatter + body). Throws a readable error when it isn't usable. */
export function parseAgentMd(md) {
  const text = String(md || '')
    .replace(/\r\n/g, '\n')
    .trim();
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m)
    throw Object.assign(
      new Error(
        'Start the file with a frontmatter block: --- name: … description: … runner: … ---',
      ),
      { status: 400 },
    );
  const meta: any = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^\s*([a-zA-Z]+)\s*:\s*(.*?)\s*(#.*)?$/);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].replace(/^["']|["']$/g, '');
  }
  const body = m[2].trim();
  if (!meta.name) throw Object.assign(new Error('The frontmatter needs a name.'), { status: 400 });
  if (!body || body.length < 40)
    throw Object.assign(
      new Error('Write the agent’s instructions under the frontmatter (at least a few sentences).'),
      { status: 400 },
    );
  const kind = CUSTOM_RUNNERS[String(meta.runner || 'review').toLowerCase()]
    ? String(meta.runner || 'review').toLowerCase()
    : 'review';
  return {
    name: meta.name.slice(0, 60),
    description: String(meta.description || '').slice(0, 300),
    kind,
    model: MODELS.includes(meta.model) ? meta.model : '',
    effort: EFFORTS.includes(meta.effort) ? meta.effort : '',
    icon: (meta.icon || '').slice(0, 4),
    body: body.slice(0, 12000),
  };
}
/** A saved custom agent ({ id, md, enabled }) as a catalog entry. */
export function customAgent(c) {
  let d;
  try {
    d = parseAgentMd(c.md);
  } catch (e) {
    return {
      id: c.id,
      custom: true,
      broken: e.message,
      name: c.id,
      icon: '⚠️',
      phase: 'General',
      team: 'Coding',
      runner: 'document',
      workspace: 'documents',
      summary: `Can’t be used: ${e.message}`,
      does: [],
      inputs: [],
      output: '',
      where: '',
      md: c.md,
      enabled: false,
    };
  }
  const r = CUSTOM_RUNNERS[d.kind];
  const where =
    r.runner === 'document'
      ? 'Administration → Agents → Hire (pick an epic)'
      : r.writes
        ? 'Issue panel → Write code with AI'
        : 'Pull requests → Review with AI, or a code job’s review';
  return {
    id: c.id,
    custom: true,
    kind: d.kind,
    name: d.name,
    icon: d.icon || (r.runner === 'document' ? '📄' : r.writes ? '🛠️' : '🔍'),
    phase: r.runner === 'document' ? 'Plan' : r.writes ? 'Build' : 'Review',
    team: r.runner === 'document' ? 'Delivery' : 'Coding',
    workspace: r.workspace,
    step: null,
    runner: r.runner,
    writes: r.writes,
    summary: d.description || d.name,
    does: d.body
      .split('\n')
      .filter((l) => /^\s*[-*]\s+/.test(l))
      .slice(0, 4)
      .map((l) => l.replace(/^\s*[-*]\s+/, '').slice(0, 160)),
    inputs:
      r.runner === 'document'
        ? ['The epic, its documents, issues and test results']
        : ['The issue and the repository'],
    output:
      r.runner === 'document'
        ? 'A Markdown document on the epic'
        : r.writes
          ? 'A diff to review'
          : 'Findings (read-only)',
    where,
    model: d.model || 'sonnet',
    effort: d.effort || 'medium',
    tools: r.writes ? WRITE_TOOLS : READ_TOOLS,
    ...(r.runner === 'document'
      ? { docPrompt: d.body }
      : {
          prompt: `${d.body}\n${CODE_RULES}${r.writes ? '' : '\n- You are read-only: never edit files. Report findings with file:line.'}`,
        }),
    md: c.md,
  };
}
/** Built-in and custom agents. */
async function allAgents() {
  const s = await getAgentSettings();
  return [...AGENTS.filter((a) => !s.removed.includes(a.id)), ...(s.custom || []).map(customAgent)];
}
// ---------------------------------------------------------------- roles: which agent does each job
// Code jobs ask for a role, not a fixed agent, so the built-in agents can be removed and custom
// ones take over.
// An administrator picks the agent per role (Administration → Agents → Default agents); otherwise
// the built-in agent of that name when it's there, otherwise the first enabled agent of the right
// kind (edits code / read-only).
export const ROLES = {
  build: { label: 'Write code', writes: true, builtIn: 'build' },
  frontend: { label: 'Frontend repository', writes: true, builtIn: 'frontend', fallback: 'build' },
  backend: { label: 'Backend repository', writes: true, builtIn: 'backend', fallback: 'build' },
  review: { label: 'Review changes', writes: false, builtIn: 'review' },
};
/** The agent id for a role, or null when there's no usable agent. */
export async function agentForRole(role) {
  const r = ROLES[role] || ROLES.build;
  const s = await getAgentSettings();
  const usable: any[] = [];
  for (const a of await allAgents()) {
    if (a.runner !== 'code' || a.broken || Boolean(a.writes) !== r.writes) continue;
    if ((s.agents[a.id]?.enabled ?? true) === false) continue;
    usable.push(a.id);
  }
  const want = s.roles?.[role];
  if (want && usable.includes(want)) return want;
  if (usable.includes(r.builtIn)) return r.builtIn;
  if (r.fallback) return agentForRole(r.fallback);
  return usable.find((id) => id.startsWith('custom-')) || usable[0] || null;
}
/** Like agentForRole, but explains what to do when there's none. */
export async function requireRole(role) {
  const id = await agentForRole(role);
  if (!id)
    throw Object.assign(
      new Error(
        ROLES[role]?.writes === false
          ? 'There’s no review agent. Create one in Administration → Agents (kind: Review).'
          : 'There’s no agent that writes code. Create one in Administration → Agents (kind: Code).',
      ),
      { status: 400 },
    );
  return id;
}
/** A built-in agent as a custom agent's Markdown, to start a custom one from it. */
export function builtInAsMd(id) {
  const a = AGENTS.find((x) => x.id === id);
  if (!a) throw Object.assign(new Error('That built-in agent doesn’t exist.'), { status: 404 });
  const kind = a.runner === 'code' ? (a.writes ? 'code' : 'review') : 'document';
  const body =
    a.runner === 'code'
      ? String(a.prompt || '')
          .replace(CODE_RULES, '')
          .trim()
      : `You are the ${a.name} agent. ${a.summary}\n\n## Do\n${a.does.map((d) => `- ${d}`).join('\n')}\n\n## Output\n${a.output}`;
  return `---\nname: ${a.name}\ndescription: ${a.summary}\nrunner: ${kind}\nmodel: ${a.model || 'sonnet'}\neffort: ${a.effort || 'medium'}\nicon: ${a.icon}\n---\n${body}\n`;
}
/** Code agents people can pick (built-in + custom). */
export async function codeAgentIds() {
  return (await allAgents()).filter((a) => a.runner === 'code' && !a.broken).map((a) => a.id);
}
/** Writes an agent's .md from a plain description, in the format above. */
export async function generateAgentMd({ description, kind = '', ai = {} }: any) {
  const md = await askAI({
    ...ai,
    task: 'agents',
    reasoning: 'fast',
    system: `You write agent definition files for TicketForge, a ticketing and test management app whose agents run as Claude Code agents on a repository (code / review) or write a Markdown document for an epic (document).
Output ONLY the file: a frontmatter block, then the instructions in Markdown. Frontmatter keys: name (2-4 words), description (one sentence), runner (code | review | document), model (opus | sonnet | haiku: haiku for simple checks, sonnet for most, opus only for hard reasoning), icon (one emoji).
Instructions: a one-line role, then "## Do" with 4-8 specific bullet rules, "## Don't" with 2-4 bullets, and "## Output" describing exactly what it returns. Concrete, testable rules. No preamble.`,
    prompt: `Write the agent for this:\n${String(description).slice(0, 3000)}${kind ? `\nRunner: ${kind}` : ''}`,
  });
  const fence = md.match(/```(?:markdown|md|yaml)?\s*([\s\S]*?)```/);
  const out = (fence && /^---/.test(fence[1].trim()) ? fence[1] : md).trim();
  parseAgentMd(out); // throws if the AI's file isn't usable
  return out;
}
// ---------------------------------------------------------------- administrator overrides
const KEY = 'agent_settings';
const C: any = wsCache('__tfAgentsWs');
function clean(o: any = {}) {
  const out: any = {};
  for (const id of Object.keys(o || {})) {
    const a = AGENTS.find((x) => x.id === id) || (/^custom-[a-z0-9-]+$/.test(id) ? { id } : null);
    if (!a) continue;
    const s = o[a.id];
    if (!s || typeof s !== 'object') continue;
    const v: any = {};
    if (typeof s.enabled === 'boolean') v.enabled = s.enabled;
    if (MODELS.includes(s.model)) v.model = s.model;
    if (EFFORTS.includes(s.effort)) v.effort = s.effort;
    if (typeof s.instructions === 'string' && s.instructions.trim())
      v.instructions = s.instructions.slice(0, 4000);
    if (Object.keys(v).length) out[a.id] = v;
  }
  return out;
}
export async function getAgentSettings({ fresh = false }: any = {}) {
  if (!fresh && C.v !== undefined && Date.now() - C.at < 30000) return C.v;
  let saved = null;
  try {
    saved = (await getMeta(wsKey(KEY))) || null;
  } catch {
    /* database not ready */
  }
  if (typeof saved === 'string') {
    try {
      saved = JSON.parse(saved);
    } catch {
      saved = null;
    }
  }
  C.v = {
    agents: clean(saved?.agents),
    custom: cleanCustom(saved?.custom),
    removed: cleanRemoved(saved?.removed),
    roles: cleanRoles(saved?.roles),
    updatedBy: saved?.updatedBy || null,
    updatedAt: saved?.updatedAt || null,
  };
  C.at = Date.now();
  return C.v;
}
const cleanRemoved = (list) => [
  ...new Set((Array.isArray(list) ? list : []).filter((id) => AGENTS.some((a) => a.id === id))),
];
const cleanRoles = (o) =>
  Object.fromEntries(
    Object.entries<any>(o && typeof o === 'object' ? o : {}).filter(
      ([k, v]) => ROLES[k] && typeof v === 'string' && /^[a-z0-9-]{1,60}$/.test(v),
    ),
  );
const cleanCustom = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((c) => c && /^custom-[a-z0-9-]+$/.test(c.id) && typeof c.md === 'string')
    .slice(0, 40)
    .map((c) => ({ id: c.id, md: c.md.slice(0, 16000) }));
export async function saveAgentSettings(actor, agents, custom?, { removed, roles }: any = {}) {
  const cur = await getAgentSettings({ fresh: true });
  const v = {
    agents: clean(agents ?? cur.agents),
    custom: custom === undefined ? cur.custom : cleanCustom(custom),
    removed: removed === undefined ? cur.removed : cleanRemoved(removed),
    roles: roles === undefined ? cur.roles : cleanRoles(roles),
    updatedBy: actor?.name || null,
    updatedAt: new Date().toISOString(),
  };
  await setMeta(wsKey(KEY), v);
  C.v = v;
  C.at = Date.now();
  return v;
}
/** One agent with the administrator's overrides applied. */
/** Adds or updates a custom agent from its .md; returns its id. */
export async function saveCustomAgent(actor, { id, md }: any) {
  const d = parseAgentMd(md);
  const s = await getAgentSettings({ fresh: true });
  const list = [...(s.custom || [])];
  let cid = id && list.some((c) => c.id === id) ? id : `custom-${slug(d.name)}`;
  if (!id) {
    let n = 2;
    while (list.some((c) => c.id === cid) || AGENTS.some((a) => a.id === cid))
      cid = `custom-${slug(d.name)}-${n++}`;
  }
  const i = list.findIndex((c) => c.id === cid);
  if (i >= 0) list[i] = { id: cid, md };
  else list.push({ id: cid, md });
  await saveAgentSettings(actor, s.agents, list);
  return cid;
}
export async function removeCustomAgent(actor, id) {
  const s = await getAgentSettings({ fresh: true });
  const agents = { ...s.agents };
  delete agents[id];
  const roles = Object.fromEntries(Object.entries<any>(s.roles || {}).filter(([, v]) => v !== id));
  await saveAgentSettings(
    actor,
    agents,
    (s.custom || []).filter((c) => c.id !== id),
    { roles },
  );
}
export async function resolveAgent(id) {
  const a = (await allAgents()).find((x) => x.id === id);
  if (!a) {
    const removed = AGENTS.find((x) => x.id === id);
    throw Object.assign(
      new Error(
        removed
          ? `The ${removed.name} agent was removed in Administration → Agents. Restore it under Built-in agents, or use one of your custom agents.`
          : `There’s no agent called “${id}”.`,
      ),
      { status: 400 },
    );
  }
  const o = (await getAgentSettings()).agents[id] || {};
  return {
    ...a,
    enabled: !a.broken && (o.enabled ?? true),
    model: o.model || a.model,
    modelSet: Boolean(o.model),
    effort: o.effort || a.effort,
    instructions: o.instructions || '',
  };
}
