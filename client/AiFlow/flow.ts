'use client';
// Everything the canvas parts need, passed as one object so each part takes a single prop.
import type { Any } from '../core';
import type { FlowActions } from './model';
import type { Graph } from './graph';
import type { Routing } from './use-routing';
import type { ProviderOps } from './use-provider-ops';
import type { Sel } from './use-viewport';

export type Flow = {
  /** The AI settings as the server reports them (GET /api/admin/ai). */
  c: Any;
  actions: FlowActions;
  g: Graph;
  routing: Routing;
  providers: ProviderOps;
  sel: Sel;
  setSel: (sel: Sel) => void;
};
