// Epic drafts: an AI-generated epic saved to review later. A draft is an epic in the project's epics with
// `draft: true`, the creator (`draftBy`) and the AI's output as generated (`aiOriginal`, never edited). The browser
// saves it like any other epic change (epic.manage); this module sends the in-app notification when a draft is saved
// or published, after checking what was really saved.
import { HttpError } from './auth';
import { getProject, NO_DRAFT_TITLE } from './store';
import { notify } from './notify';

export const DRAFT_EVENTS = ['saved', 'published'];

/**
 * Notifies the draft's creator and the project owner (the same person is told once) that the draft was saved or
 * published. Refused (404/409) when the epic isn't saved in that state yet, and (400) when a published epic has no
 * title. Returns how many people were notified.
 */
export async function notifyDraft(projectId: string, epicId: string, event: string, user: any) {
  if (!DRAFT_EVENTS.includes(event)) throw new HttpError(400, 'The event must be saved or published.');
  const project = await getProject(projectId);
  const epic = (project.epics || []).find((e: any) => e.id === String(epicId));
  if (!epic || !epic.aiOriginal) throw new HttpError(404, 'That epic isn’t an AI draft in this project (save first if you just created it).');
  if (event === 'saved' && !epic.draft) throw new HttpError(409, 'That epic is already published.');
  if (event === 'published') {
    if (epic.draft) throw new HttpError(409, 'That draft isn’t published yet.');
    if (!String(epic.title || '').trim()) throw new HttpError(400, NO_DRAFT_TITLE);
  }
  const ids = [...new Set([epic.draftBy?.id || user?.id, project.createdBy].filter(Boolean))] as string[];
  const saved = event === 'saved';
  const title = saved ? `Epic draft saved: ${epic.title || epic.key}` : `Epic published: ${epic.title}`;
  const text = saved
    ? `${user?.name || 'Someone'} saved ${epic.key} as a draft in ${project.name}. Review and publish it when it’s ready.`
    : `${user?.name || 'Someone'} published the draft ${epic.key} in ${project.name} as an epic.`;
  for (const userId of ids) {
    await notify({ userId, projectId, kind: saved ? 'epic-draft-saved' : 'epic-published', title, body: text, link: `/p/${projectId}/epics?epic=${encodeURIComponent(epic.id)}` });
  }
  return { notified: ids.length };
}
