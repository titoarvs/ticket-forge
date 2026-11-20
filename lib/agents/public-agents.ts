import {
  getAgentSettings,
  customAgent,
  ROLES,
  agentForRole,
  codeAgentIds,
  resolveAgent,
} from './parse-agent-md';
import { AGENTS } from './agents';
import { WORKSPACES, PHASES, TEAMS, MODELS, EFFORTS } from './review-lenses';

/**
 * The catalog for the browser: definitions plus overrides (prompts included, so admins see what
 * each agent is told).
 */
export async function publicAgents() {
  const s = await getAgentSettings({ fresh: true });
  return {
    agents: [
      ...AGENTS.filter((a) => !s.removed.includes(a.id)),
      ...(s.custom || []).map(customAgent),
    ].map((a) => {
      const o = s.agents[a.id] || {};
      return {
        ...a,
        workspaceLabel: WORKSPACES[a.workspace],
        enabled: !a.broken && (o.enabled ?? true),
        model: o.model || a.model || null,
        effort: o.effort || a.effort || null,
        instructions: o.instructions || '',
        defaults: { model: a.model || null, effort: a.effort || null },
      };
    }),
    phases: PHASES,
    teams: TEAMS,
    models: MODELS,
    efforts: EFFORTS,
    updatedBy: s.updatedBy,
    updatedAt: s.updatedAt,
    removed: s.removed.map((id) => {
      const a = AGENTS.find((x) => x.id === id);
      return { id, name: a.name, icon: a.icon, summary: a.summary, runner: a.runner };
    }),
    builtIns: AGENTS.map((a) => ({
      id: a.id,
      name: a.name,
      icon: a.icon,
      runner: a.runner,
      writes: Boolean(a.writes),
      removed: s.removed.includes(a.id),
    })),
    roles: Object.fromEntries(
      await Promise.all(
        Object.keys(ROLES).map(async (k) => [
          k,
          {
            label: ROLES[k].label,
            writes: ROLES[k].writes,
            chosen: s.roles?.[k] || '',
            agent: await agentForRole(k),
          },
        ]),
      ),
    ),
  };
}
/**
 * The `--agents` JSON for Claude Code: every enabled code agent (the run picks one with `--agent`).
 * Each prompt gets the administrator's extra instructions and the project's conventions.
 */
export async function claudeAgentsJson({ notes = '', checkTool = '' }: any = {}) {
  const out: any = {};
  for (const id of await codeAgentIds()) {
    const a = await resolveAgent(id);
    if (!a.enabled) continue;
    const prompt = [
      a.prompt,
      a.instructions && `\nInstructions from your team's administrator:\n${a.instructions}`,
      notes && `\nTeam conventions for this repository:\n${notes}`,
    ]
      .filter(Boolean)
      .join('\n');
    const extra = Array.isArray(checkTool) ? checkTool : checkTool ? [checkTool] : [];
    out[id] = {
      description: `${a.summary} ${a.does.join(' ')}`,
      prompt,
      tools: [...a.tools.filter((t) => t !== 'Task' && t !== 'Agent'), ...extra],
      model: a.model,
    };
  }
  return out;
}
/** Throws when an administrator turned the agent off. */
export async function ensureAgent(id) {
  const a = await resolveAgent(id);
  if (!a.enabled)
    throw Object.assign(
      new Error(`The ${a.name} agent is turned off in Administration → Agents.`),
      { status: 400 },
    );
  return a;
}
/**
 * The administrator's extra instructions for an agent, as a block to add to a system prompt (''
 * when none).
 */
export async function agentInstructions(id) {
  let a;
  try {
    a = await resolveAgent(id);
  } catch {
    return '';
  }
  return a.instructions
    ? `\n\nInstructions from your team's administrator for the ${a.name} agent:\n${a.instructions}`
    : '';
}
