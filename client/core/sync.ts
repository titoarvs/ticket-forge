'use client';
import {
  P,
  S,
  api,
  mergeRemote,
  emit,
  hasLocalChanges,
  scheduleSave,
  type Any,
  toast,
  takeRevs,
  ensureProject,
  setBase,
  openIssue,
  openEpic,
  saveNow,
  EMPTY_FILTER,
} from './state';

/**
 * Brings in teammates' changes: only what changed since this browser's version, merged with unsaved
 * edits.
 */
export async function pullRemote({ force = false, quiet = false } = {}) {
  const p = P();
  if (!p || S.saving) return;
  if (force || !S.base) return pullFull({ force, quiet });
  try {
    const d = await api(`/api/projects/${p.id}/changes?since=${p.version}`);
    if (P() !== p || S.saving) return;
    if (d.full) return pullFull({ quiet });
    if (d.version <= p.version) return;
    // The version moved but nothing is listed: an older server saved without recording what
    // changed. Reload.
    if (!d.upsert?.length && !d.remove?.length && !Object.keys(d.meta || {}).length && !d.order)
      return pullFull({ quiet });
    const changed = mergeRemote(p, {
      tickets: d.upsert || [],
      remove: d.remove || [],
      meta: d.meta || {},
      order: d.order,
      revs: d.revs,
    });
    p.version = d.version;
    if (changed && !quiet) S.saveText = 'Updated with teammates’ changes';
    if (changed) emit();
    if (hasLocalChanges()) {
      if (!S.saveTimer) scheduleSave();
    } // merged edits still to save
    else S.baseSeq = S.mutSeq;
  } catch (e: Any) {
    if (e.status === 404) toast(e.message, 'err');
  }
}
async function pullFull({ force = false, quiet = false } = {}) {
  const p = P();
  if (!p) return;
  if (!force && hasLocalChanges()) return;
  try {
    const fresh = await fetchProject(p.id);
    if (P() !== p || (!force && hasLocalChanges())) return;
    S.revs = takeRevs(fresh);
    S.project = ensureProject(fresh);
    setBase();
    S.dataRev += 1;
    S.undo = [];
    S.redo = [];
    if (S.drawer && !(openIssue() || openEpic())) S.drawer = null;
    if (!quiet) S.saveText = 'Updated with teammates’ changes';
    emit();
  } catch (e: Any) {
    if (force) toast(e.message, 'err');
  }
}
let syncStarted = false;
export function startSync() {
  if (syncStarted) return;
  syncStarted = true;
  const check = async () => {
    const p = P();
    if (!p || S.saving || S.saveTimer || document.visibilityState !== 'visible') return;
    try {
      const { version } = await api(`/api/projects/${p.id}/version`);
      if (P() === p && version > p.version) await pullRemote();
    } catch {
      /* offline or signed out */
    }
  };
  // Every 10 s (a little random, so thousands of open tabs don't all ask in the same second), and
  // at once when the tab comes back into view.
  const loop = () =>
    setTimeout(
      async () => {
        await check();
        loop();
      },
      8000 + Math.random() * 4000,
    );
  loop();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}
/** Notifications for the signed-in user (bell in the top bar). */
export async function loadNotifs() {
  if (!S.user) return;
  try {
    S.notifs = await api('/api/notifications');
    S.notifsLoaded = true;
    S.notifsError = null;
    emit();
  } catch (e: Any) {
    if (!S.notifsLoaded) {
      S.notifsError = e;
      emit();
    } /* else keep the last list (offline for a moment) */
  }
}
export async function markNotifsRead(ids?: string[]) {
  await api('/api/notifications/read', { method: 'POST', body: { ids } }).catch(() => {});
  await loadNotifs();
}
/**
 * The whole project. Downloaded gzipped and unpacked here when the browser can (a big project is
 * ~30× smaller).
 */
export async function fetchProject(id: string): Promise<Any> {
  if (typeof DecompressionStream === 'function') {
    try {
      const res = await api(`/api/projects/${id}?gz=1`, { raw: true });
      if (res.headers.get('content-type')?.includes('octet-stream') && res.body) {
        return JSON.parse(
          await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).text(),
        );
      }
      return await res.json();
    } catch (e: Any) {
      if (e.status) throw e; /* unpacking failed: fall back to plain JSON */
    }
  }
  return api(`/api/projects/${id}`);
}
/** Load a project (once) for the workspace. */
export async function openProject(id: string) {
  if (S.project?.id === id || S.loadingProject === id) return;
  if (P()) await saveNow();
  S.loadingProject = id;
  S.projectError = null;
  emit();
  try {
    const raw = await fetchProject(id);
    S.revs = takeRevs(raw);
    const p = ensureProject(raw);
    Object.assign(S, {
      project: p,
      undo: [],
      redo: [],
      drawer: null,
      full: false,
      inlineCreate: null,
      filter: EMPTY_FILTER(),
      boardAll: false,
    });
    S.checked.clear();
    S.openTc.clear();
    setBase();
    S.people = await api(`/api/projects/${id}/people`).catch(() => []);
  } catch (e: Any) {
    S.projectError = { id, status: e.status, message: e.message };
    // Not in this workspace: is it in another workspace of yours? Then the page offers to switch
    // there.
    if (e.status === 404) {
      const w = await api(`/api/workspaces/locate?project=${encodeURIComponent(id)}`).catch(
        () => null,
      );
      if (w?.workspace) S.projectError.elsewhere = w.workspace;
    }
  } finally {
    S.loadingProject = null;
    emit();
  }
}
export async function closeProject() {
  if (P()) await saveNow();
  Object.assign(S, { project: null, drawer: null, people: [], revs: { issues: {}, meta: {} } });
  emit();
}
