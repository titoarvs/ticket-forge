'use client';
// Applying a reviewed repository sync in one undo step: App setup pages, the test cases the code
// changes affect, and delivered work in the backlog. Then a toast says what changed.
import {
  type Any,
  P,
  mutate,
  uid,
  me,
  logEvent,
  newTest,
  setField,
  newTicket,
  closeModal,
  toast,
  S,
} from '../../core';
import { doneStatus } from '../RepoSyncCard';
import { KEY, type Pick } from './keys';

const WHO = 'Repository sync';

type Counts = {
  pagesAdded: number;
  tcs: number;
  tcsAdded: number;
  closed: number;
  created: number;
};

/** App setup pages: drop ticked removals, refresh files (or mark missing), add ticked new pages. */
function applyPages(pp: Any, r: Any, pick: Pick, newPages: Any[], c: Counts) {
  const files = new Map(r.pages.map((pg: Any) => [pg.path, pg.file]));
  pp.automation.app = { pages: [], roles: [], login: {}, notes: '', ...(pp.automation.app || {}) };
  const x = pp.automation.app;
  x.pages = x.pages
    .filter((pg: Any) => !(pg.fromCode && pick[KEY.gone(pg)]))
    .map((pg: Any) =>
      files.has(pg.path)
        ? { ...pg, file: files.get(pg.path) || pg.file, missing: false }
        : pg.fromCode
          ? { ...pg, missing: true }
          : pg,
    );
  for (const pg of newPages) {
    if (!pick[KEY.page(pg)]) continue;
    const page = { name: pg.name, path: pg.path, description: '', fromCode: true, file: pg.file };
    x.pages.push({ id: uid(), ...page });
    c.pagesAdded++;
  }
}

/** Rewritten test cases lose their old script (it no longer matches) and run again. */
function applyTests(pp: Any, r: Any, pick: Pick, c: Counts) {
  for (const u of r.tests.updates) {
    if (!pick[KEY.upd(u)]) continue;
    const t = pp.tickets.find((y: Any) => y.id === u.ticketId);
    const tc = t?.testCases.find((tc: Any) => tc.id === u.tcId);
    if (!tc) continue;
    Object.assign(tc, u.after, { script: '', status: 'Not run', lastRun: null });
    logEvent(t, `updated test case “${u.after.title}” after code changes: ${u.why}`, WHO);
    c.tcs++;
  }
  for (const ad of r.tests.additions) {
    if (!pick[KEY.add(ad)]) continue;
    const t = pp.tickets.find((y: Any) => y.id === ad.ticketId);
    if (!t) continue;
    t.testCases.push({ ...newTest(), ...ad.tc });
    logEvent(t, `added test case “${ad.tc.title}” for new behaviour: ${ad.why}`, WHO);
    c.tcsAdded++;
  }
}

function deliveredDescription(ni: Any) {
  const pages = ni.pages.length ? `\n\nPages: ${ni.pages.join(', ')}` : '';
  const where = ni.evidence ? `\n\nDelivered in: ${ni.evidence}` : '';
  return `${ni.description}${pages}${where}`;
}

/** Delivered work: close the matching issues, add features that have no issue yet (as done). */
function applyBacklog(pp: Any, r: Any, pick: Pick, done: string, c: Counts) {
  for (const d of r.built.done) {
    if (!pick[KEY.done(d)]) continue;
    const t = pp.tickets.find((y: Any) => y.id === d.ticketId);
    if (!t) continue;
    setField(t, 'status', done, WHO);
    logEvent(t, `marked ${done}: delivered in the repository (${d.evidence})`, WHO);
    c.closed++;
  }
  for (const ni of r.built.newIssues) {
    if (!pick[KEY.new(ni)]) continue;
    const t = newTicket({
      title: ni.title,
      type: ni.type,
      epicId: ni.epicId,
      userStory: ni.userStory,
      status: done,
      labels: ['delivered'],
      description: deliveredDescription(ni),
      acceptanceCriteria: ni.acceptanceCriteria,
    });
    logEvent(t, 'added from the repository history: already delivered', WHO);
    pp.tickets.push(t);
    c.created++;
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

function report(r: Any, c: Counts, done: string) {
  const parts = [
    c.pagesAdded && `${plural(c.pagesAdded, 'page')} added`,
    c.tcs && `${plural(c.tcs, 'test case')} updated`,
    c.tcsAdded && `${c.tcsAdded} added`,
    c.closed && `${plural(c.closed, 'issue')} marked ${done}`,
    c.created && `${plural(c.created, 'delivered feature')} added to the backlog`,
  ].filter(Boolean);
  const rescript = c.tcs ? ' Updated test cases get new scripts on their next run.' : '';
  toast(
    parts.length
      ? `${parts.join(' · ')}.${rescript}`
      : `Synced at ${String(r.repo.head).slice(0, 7)}. Nothing else to change.`,
    'ok',
    {
      title: 'Repository synced',
      action:
        c.created || c.closed
          ? { label: 'Open backlog', onClick: () => S.nav(`/p/${P().id}/backlog`) }
          : undefined,
    },
  );
}

export function applySync(r: Any, pick: Pick, newPages: Any[], changedPages: Any[]) {
  const done = doneStatus();
  const c: Counts = { pagesAdded: 0, tcs: 0, tcsAdded: 0, closed: 0, created: 0 };
  mutate((pp: Any) => {
    applyPages(pp, r, pick, newPages, c);
    pp.automation.repoSync = {
      sha: r.repo.head,
      branch: r.repo.branch,
      at: new Date().toISOString(),
      by: me(),
      pages: r.pages.length,
      changed: changedPages.length,
    };
    applyTests(pp, r, pick, c);
    applyBacklog(pp, r, pick, done, c);
  });
  closeModal();
  report(r, c, done);
}
