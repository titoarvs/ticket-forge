// Workspace settings in app_meta. Each workspace keeps its own AI providers, agents, feature flags,
// generation rules and test browser. The default workspace (data from before workspaces) keeps the
// original keys, so nothing moves and older copies of the app still read the same settings; other
// workspaces use "ws:<id>:<key>".
import { currentWs, DEFAULT_WS } from './db';

export const wsKey = (key, ws = currentWs()) =>
  !ws || ws === DEFAULT_WS ? key : `ws:${ws}:${key}`;

/**
 * A per-workspace in-memory cache that reads and writes like a plain object ({ v, at, … }: any):
 * each workspace gets its own copy, so one company's cached settings never answer for another.
 */
export function wsCache(name: string, init: () => any = () => ({ v: undefined, at: 0 })) {
  const all = (globalThis[name] ??= new Map());
  const cur = () => {
    const ws = currentWs() || DEFAULT_WS;
    if (!all.has(ws)) all.set(ws, init());
    return all.get(ws);
  };
  return new Proxy(
    {},
    {
      get: (_, k) => cur()[k],
      set: (_, k, v) => {
        cur()[k] = v;
        return true;
      },
    },
  );
}
