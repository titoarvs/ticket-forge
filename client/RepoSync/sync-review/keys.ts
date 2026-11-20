// The tick-box key of each kind of change in a sync review. Keys start with their kind, so the
// ticked ones of a kind can be counted.
import type { Any } from '../../core';

export const KEY = {
  page: (pg: Any) => `page:${pg.path}`,
  gone: (pg: Any) => `gone:${pg.id}`,
  upd: (u: Any) => `upd:${u.tcId}`,
  add: (ad: Any) => `add:${ad.ticketKey}:${ad.tc.title}`,
  done: (d: Any) => `done:${d.ticketId}`,
  new: (ni: Any) => `new:${ni.title}`,
};

export type Pick = Record<string, boolean>;

/** What the sync found compared with App setup: new pages, changed pages, pages no longer there. */
export function pageDiff(r: Any, appPages: Any[]) {
  const have = new Set(appPages.map((pg: Any) => pg.path));
  const inCode = new Set(r.pages.map((pg: Any) => pg.path));
  return {
    newPages: r.pages.filter((pg: Any) => !have.has(pg.path)) as Any[],
    changedPages: r.pages.filter((pg: Any) => pg.changedFiles.length) as Any[],
    gone: appPages.filter((pg: Any) => pg.fromCode && !inCode.has(pg.path)) as Any[],
  };
}

/** Everything ticked to start with, except removing pages. */
export function initialPick(r: Any, d: ReturnType<typeof pageDiff>): Pick {
  const on = (list: Any[], key: (x: Any) => string, init = true) =>
    Object.fromEntries(list.map((x) => [key(x), init]));
  return {
    ...on(d.newPages, KEY.page),
    ...on(d.gone, KEY.gone, false),
    ...on(r.tests.updates, KEY.upd),
    ...on(r.tests.additions, KEY.add),
    ...on(r.built.done, KEY.done),
    ...on(r.built.newIssues, KEY.new),
  };
}

/** Opens on the first tab with something to review. */
export function firstTab(r: Any) {
  if (r.tests.updates.length || r.tests.additions.length) return 'tests';
  if (r.built.done.length || r.built.newIssues.length) return 'backlog';
  return 'pages';
}
