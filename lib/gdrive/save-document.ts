import { q, qs, asWorkspace } from '../db';
import { isLocked } from '../features';
import { projectWorkspace } from '../store';
import { type Doc, attempt, MAX_RETRIES, FAILED_MESSAGE, G, TICK } from './complete-connect';

/**
 * Saves a document to the Drive folder. It is recorded as queued first, so it is never lost, and
 * tried once right away; if that fails it stays queued for the background retries. Never throws for
 * a Drive problem. Returns the state.
 */
export async function saveDocument({
  projectId,
  epicId,
  kind,
  docKey = '',
  name,
  mime,
  data,
  user,
}: Doc & { name: string; mime: string; data: Buffer; user?: any }) {
  // Not due for a minute, so the background retry doesn't pick it up while this first try runs.
  await q(
    `insert into drive_docs (project_id, epic_id, kind, doc_key, name, mime, state, attempts, next_attempt_at, last_error, drive_file_id, data, created_by, updated_at)
    values ($1,$2,$3,$4,$5,$6,'queued',0,$7,'','',$8,$9,now())
    on conflict (project_id, epic_id, kind, doc_key) do update set name = excluded.name, mime = excluded.mime, state = 'queued', attempts = 0,
      next_attempt_at = excluded.next_attempt_at, last_error = '', drive_file_id = '', data = excluded.data, created_by = excluded.created_by, updated_at = now()`,
    [
      projectId,
      epicId,
      kind,
      docKey,
      String(name).slice(0, 200),
      mime,
      new Date(Date.now() + 60 * 1000).toISOString(),
      data,
      user?.name || null,
    ],
  );
  startWorker();
  return attempt({ projectId, epicId, kind, docKey });
}
/** A document that couldn't even be prepared (nothing to retry): shown as failed. */
export async function markFailed({
  projectId,
  epicId,
  kind,
  docKey = '',
  name,
  error,
  user,
}: Doc & { name: string; error: string; user?: any }) {
  await q(
    `insert into drive_docs (project_id, epic_id, kind, doc_key, name, state, attempts, last_error, created_by, updated_at) values ($1,$2,$3,$4,$5,'failed',$6,$7,$8,now())
    on conflict (project_id, epic_id, kind, doc_key) do update set name = excluded.name, state = 'failed', attempts = $6, next_attempt_at = null, last_error = excluded.last_error, drive_file_id = '', data = null, updated_at = now()`,
    [
      projectId,
      epicId,
      kind,
      docKey,
      String(name).slice(0, 200),
      MAX_RETRIES + 1,
      String(error).slice(0, 300),
      user?.name || null,
    ],
  );
}
/**
 * The save state of each document of an epic: [{ kind, key, name, state: 'saved' | 'queued' |
 * 'failed', retries, maxRetries, message }].
 */
export async function documentStates(projectId: string, epicId: string, user: any = null) {
  const rows = (
    await q(
      'select kind, doc_key, name, state, attempts, last_error, updated_at from drive_docs where project_id = $1 and epic_id = $2 order by updated_at desc',
      [projectId, epicId],
    )
  ).rows;
  return rows.map((r: any) => ({
    kind: r.kind,
    key: r.doc_key,
    name: r.name,
    state: r.state,
    retries: Math.max(0, r.attempts - 1),
    maxRetries: MAX_RETRIES,
    at: r.updated_at,
    message:
      r.state === 'failed'
        ? FAILED_MESSAGE
        : r.state === 'queued'
          ? 'Google Drive couldn’t be reached. TicketForge keeps trying in the background.'
          : '',
    ...(user?.is_owner && r.last_error ? { error: r.last_error } : {}), // the reason is for the Super Admin only
  }));
}
// ---------------------------------------------------------------- background retries
/**
 * Retries every queued document that is due, in the workspace it belongs to. Failed documents are
 * never touched.
 */
export async function retryDue() {
  if (G.__tfGdriveBusy) return 0;
  G.__tfGdriveBusy = true;
  let n = 0;
  try {
    const due = (
      await qs(
        `select project_id, epic_id, kind, doc_key from drive_docs where state = 'queued' and next_attempt_at <= now() order by next_attempt_at limit 20`,
      )
    ).rows;
    for (const r of due) {
      const ws = await projectWorkspace(r.project_id);
      if (!ws) continue;
      await asWorkspace(ws, async () => {
        if (await isLocked('gdrive')) return; // switched off: nothing is sent until it is turned on again
        await attempt({
          projectId: r.project_id,
          epicId: r.epic_id,
          kind: r.kind,
          docKey: r.doc_key,
        });
        n++;
      });
    }
  } finally {
    G.__tfGdriveBusy = false;
  }
  return n;
}
/** Starts the timer that retries queued documents (once per server process). */
export function startWorker() {
  if (G.__tfGdriveTimer) return;
  G.__tfGdriveTimer = setInterval(() => {
    retryDue().catch((e: Error) => console.error('Google Drive retry:', e.message));
  }, TICK);
  G.__tfGdriveTimer.unref?.();
}
