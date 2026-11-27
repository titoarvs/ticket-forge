// POST …/{psd|fbd|ard}/answers: updates an epic document with the team's answers to its open
// questions. Nothing is saved here: the app stores the result on the epic.
import { api, authed, body, HttpError, aiOpts, ndjson } from './http';
import * as store from '../store';
import { answerOpenQuestions } from '../doc-answers';
import { saveGeneratedToDrive } from '../epic-docx';

const NAMES = { psd: 'Problem Statement', fbd: 'Feature Brief', ard: 'Architecture Record Design' };

export function docAnswersPost(kind: 'psd' | 'fbd' | 'ard') {
  return api(async (req, p) => {
    const user = await authed();
    store.requireAccess(user, p.id);
    if (!store.has(user, 'ai.use') || !store.has(user, 'epic.manage'))
      throw new HttpError(403, `Updating a ${NAMES[kind]} needs the AI and epic permissions.`);
    const b = await body(req);
    const project = await store.getProject(p.id);
    const epic = project.epics.find((e: any) => e.id === b.epicId);
    if (!epic?.[kind]) throw new HttpError(404, `This epic has no ${NAMES[kind]} yet.`);
    return ndjson(req, async (send) => {
      send({ type: 'progress', message: `Updating the ${NAMES[kind]} with your answers…` });
      const out: any = await answerOpenQuestions({
        kind,
        project,
        epicId: String(b.epicId),
        answers: b.answers,
        ai: aiOpts(b),
      });
      const doc = kind === 'psd' ? { ...epic.psd, ...out.psd } : { ...epic[kind], ...out };
      const drive = await saveGeneratedToDrive({ kind, project, epic, user, doc });
      send({ type: 'done', ...out, drive });
    });
  });
}
