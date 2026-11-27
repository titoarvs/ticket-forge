import { api, authed, body, HttpError, aiOpts, ndjson } from '@/lib/server/http';
import * as store from '@/lib/store';
import { generatePsd } from '@/lib/psd';
import { saveGeneratedToDrive } from '@/lib/epic-docx';

// Writing a PSD takes a minute or two.
export const maxDuration = 300;

// Writes the Problem Statement for one epic. Nothing is saved here: the app stores it on the epic.
export const POST = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  if (!store.has(user, 'ai.use') || !store.has(user, 'epic.manage'))
    throw new HttpError(403, 'Writing a Problem Statement needs the AI and epic permissions.');
  const b = await body(req);
  const project = await store.getProject(p.id);
  if (!project.epics.some((e: any) => e.id === b.epicId))
    throw new HttpError(
      404,
      'That epic isn’t in this project (save first if you just created it).',
    );
  return ndjson(req, async (send) => {
    send({ type: 'progress', message: 'Reading the epic, its issues and the source documents…' });
    const psd = await generatePsd({
      project,
      epicId: String(b.epicId),
      instructions: String(b.instructions || '').slice(0, 6000),
      ai: aiOpts(b),
    });
    // With Google Drive on, the Word file goes to the Drive folder (or the retry queue); `drive.state` is its save state.
    const epic = project.epics.find((e: any) => e.id === b.epicId);
    const drive = await saveGeneratedToDrive({
      kind: 'psd',
      project,
      epic,
      user,
      doc: {
        ...psd,
        version: epic.psd?.version || 'v1.0',
        status: epic.psd?.status || 'Draft',
        generatedAt: new Date().toISOString(),
        generatedBy: user.name,
      },
    });
    send({ type: 'done', psd, drive });
  });
});
