// TicketForge agents: one definition per job in the feature lifecycle (Prepare → Plan → Build →
// Review → Release).
// Each agent says what it does, what it reads, what it produces, where it works and which workflow
// step it serves.
//
// Agents with runner "code" run as real Claude Code agents (`claude -p --agents … --agent <id>`),
// the same way Claude Code runs custom agents: their prompt is the agent's system prompt, their
// tool list is enforced by Claude Code. Each run is one agent working on its own (no subagents:
// delegating made runs much slower and lost the issue's context); a person chains them, e.g. Build,
// then Review. Agents with runner "document" write a document for an epic in TicketForge (the Agent
// doc); runner "guide" agents walk a person through a manual step.
//
// Administrators can turn agents on or off and set their model, effort and extra instructions in
// Administration → Agents. Overrides are stored in app_meta under "agent_settings".

export { PHASES, TEAMS, REVIEW_LENSES, WORKSPACES, MODELS, EFFORTS } from './agents/review-lenses';
export { AGENTS } from './agents/agents';
export {
  CODE_AGENT_IDS,
  parseAgentMd,
  ROLES,
  agentForRole,
  requireRole,
  builtInAsMd,
  codeAgentIds,
  generateAgentMd,
  getAgentSettings,
  saveAgentSettings,
  saveCustomAgent,
  removeCustomAgent,
  resolveAgent,
} from './agents/parse-agent-md';
export {
  publicAgents,
  claudeAgentsJson,
  ensureAgent,
  agentInstructions,
} from './agents/public-agents';
