import { api, authed, body, HttpError, aiOpts, ndjson } from '@/lib/server/http';
import * as store from '@/lib/store';
import { generateArd } from '@/lib/ard';
import { saveGeneratedToDrive } from '@/lib/epic-docx';

export const maxDuration = 300;

// Writes the Architecture Record Design for one epic from the project's (or team's) template. Nothing is saved here:
// the app stores it on the epic (epic.ard).
export const POST = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  if (!store.has(user, 'ai.use') || !store.has(user, 'epic.manage'))
    throw new HttpError(
      403,
      'Writing an Architecture Record Design needs the AI and epic permissions.',
    );
  const b = await body(req);
  const project = await store.getProject(p.id);
  const epic = project.epics.find((e: any) => e.id === b.epicId);
  if (!epic)
    throw new HttpError(
      404,
      'That epic isn’t in this project (save first if you just created it).',
    );
  const meta = {
    version: epic.ard?.version || 'v1.0',
    status: epic.ard?.status || 'Draft',
    date: new Date().toISOString().slice(0, 10),
    preparedBy: user.name,
  };
  return ndjson(req, async (send) => {
    send({
      type: 'progress',
      message:
        'Filling the Architecture Record Design template from the epic, its Feature Brief and its issues…',
    });
    const out = await generateArd({
      project,
      epicId: String(b.epicId),
      instructions: String(b.instructions || '').slice(0, 6000),
      ai: aiOpts(b),
      meta,
    });
    const drive = out?.markdown
      ? await saveGeneratedToDrive({
          kind: 'ard',
          project,
          epic,
          user,
          doc: { markdown: out.markdown, version: meta.version },
        })
      : null;
    send({ type: 'done', ...out, meta, drive });
  });
});
