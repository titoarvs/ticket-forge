'use client';
// Epic drafts: an AI-generated epic saved to review later. A draft is an epic with `draft: true` that keeps the AI's
// output as generated (`aiOriginal`) for reference. It shows in the epic list with a Draft badge, its title and
// description can be edited, and Publish turns it into a real epic. The creator and the project owner are notified.
import { S, P, api, toast, mutate, saveNow, can, me, nextEpicKey, COLORS, nowIso, type Any } from './core';

const NO_TITLE = 'Give the draft a title before you publish it.';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Saves pending changes and waits until they are stored (the notification checks what is stored). */
async function flush() {
  for (let i = 0; i < 20; i++) {
    await saveNow();
    if (!S.saving && !S.saveTimer) return;
    await wait(200);
  }
}
const notifyDraft = (epicId: string, event: 'saved' | 'published') =>
  api(`/api/projects/${encodeURIComponent(P().id)}/epic-drafts`, { method: 'POST', body: { epicId, event } });

/** The AI epic and the issues it planned, as generated. Kept unchanged on the draft. */
const originalOf = (e: Any, items: Any[]) => JSON.parse(JSON.stringify({
  title: e.title, description: e.description || '',
  issues: items.map((t: Any) => ({ title: t.title, type: t.type, priority: t.priority, storyPoints: t.storyPoints, userStory: t.userStory, description: t.description, acceptanceCriteria: t.acceptanceCriteria })),
}));

/** Save as draft: stores the generated epic (e) and its planned issues (items) as a draft epic. Returns true when it was saved. */
export async function saveEpicDraft(e: Any, items: Any[]): Promise<boolean> {
  if (!can('epic.manage')) { toast('Your role can’t create epics, so it can’t save drafts.', 'err'); return false; }
  const id = e.id;
  mutate((pp) => {
    pp.epics.push({
      id, key: nextEpicKey(), title: e.title, description: e.description || '', color: COLORS[pp.epics.length % COLORS.length],
      ...(e.docs?.psd ? { psd: e.docs.psd } : {}), ...(e.docs?.fbd ? { fbd: e.docs.fbd } : {}), ...(e.docs?.ard ? { ard: e.docs.ard } : {}),
      draft: true, draftBy: { id: S.user?.id || null, name: me() }, draftAt: nowIso(), aiOriginal: originalOf(e, items),
    });
  });
  try {
    await flush();
    await notifyDraft(id, 'saved');
    toast(`Saved “${e.title}” as a draft`);
  } catch (err: Any) { toast(`The draft is saved, but the notification failed: ${err.message}`, 'err'); }
  return true;
}

/** Publish: turns a draft into a real epic. Blocked, with a message, when the title is empty. */
export async function publishEpicDraft(e: Any) {
  if (!can('epic.manage')) return;
  if (!String(e.title || '').trim()) { toast(NO_TITLE, 'err'); return; }
  mutate(() => { delete e.draft; e.publishedAt = nowIso(); });
  try {
    await flush();
    await notifyDraft(e.id, 'published');
    toast(`Published ${e.key}`);
  } catch (err: Any) { toast(err.message, 'err'); }
}

export const DraftBadge = () => <span className="loz t-blocked" title="An AI-generated epic that isn’t published yet">Draft</span>;

/** In the epic panel: the AI's output as generated, for reference (read-only, never edited). */
export function DraftReference({ e }: { e: Any }) {
  const o = e.aiOriginal;
  if (!o) return null;
  return (
    <div className="sec"><div className="sec-title"><h3>Original AI output</h3></div>
      <details className="feat-q" data-testid="draft-reference">
        <summary className="small">Shown as the AI wrote it, for reference. Edits to the epic above don’t change it.</summary>
        <p><b>{o.title}</b></p>
        {o.description && <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{o.description}</p>}
        {o.issues?.length > 0 && <>
          <p className="muted small" style={{ marginBottom: 4 }}>Planned issues ({o.issues.length})</p>
          <ul className="small">{o.issues.map((t: Any, i: number) => <li key={i}><b>{t.title}</b>{t.userStory ? <> — <i>{t.userStory}</i></> : null}</li>)}</ul></>}
      </details>
    </div>
  );
}

/** In the epic panel of a draft: what it is and the Publish action. */
export function DraftBanner({ e }: { e: Any }) {
  return (
    <div className="warn-banner"><DraftBadge /><span>This epic is a draft. Review and edit it, then publish it to make it a real epic.</span>
      {can('epic.manage') && <button className="btn sm primary" style={{ marginLeft: 'auto' }} onClick={() => publishEpicDraft(e)}>Publish</button>}</div>
  );
}
