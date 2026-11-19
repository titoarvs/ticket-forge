'use client';

// Administration → AI → AI flow: the AI settings as a canvas of nodes you wire together, like n8n.
//
//   tasks (grouped)  ──►  tiers (High · Standard · Light)  ──►  router  ──►  provider ──fallback──► provider ──► …
//
//  · Drag from a task's dot onto a tier (or an AI configuration) to choose what that task runs on.
//  · Drag a provider's bottom dot onto another provider to make that one the next fallback (the priority order).
//  · Click a node for its details: status, test, the model it uses for each tier, switches.
//  · Drag nodes to arrange them, drag the background to pan, Ctrl/⌘ + scroll or pinch to zoom.
// Every change is saved straight away through the same settings the other AI sections use.

export type { FlowActions } from './AiFlow/FlowActions';
export { AiFlow } from './AiFlow/AiFlow';
