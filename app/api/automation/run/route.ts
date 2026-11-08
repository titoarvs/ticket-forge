import { api, perm, body, HttpError, aiOpts, ndjson, appUrl } from '@/lib/server/http';
import { engineStatus, runAutomation, noBrowser } from '@/lib/automation.js';
import { reportRun } from '@/lib/notify.js';
import * as store from '@/lib/store.js';
import { runAppSetup } from '@/lib/server/app-setup';

export const POST = api(async (req) => {
  const user = await perm('test.run');
  const b = await body(req);
  const { items, baseUrl, regenerate, project } = b;
  if (project?.id) store.requireAccess(user, project.id);
  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) throw new HttpError(400, 'Set a base URL (http:// or https://) for the app under test.');
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'No test cases to run.');
  if ((regenerate || items.some((i: any) => !i.tc?.script?.trim())) && !store.has(user, 'ai.use')) {
    throw new HttpError(403, 'Some tests have no script yet, and writing scripts uses Claude, which your role does not allow (ai.use). Run tests that already have scripts, or ask an administrator.');
  }
  if (!(await engineStatus()).browser) throw new HttpError(400, noBrowser());
  const origin = appUrl(req);
  // Pages, roles and login settings come from the saved project; passwords only for its saved application URL.
  const { app, warning } = await runAppSetup(project?.id, baseUrl);
  return ndjson(req, async (send, signal) => {
    if (warning) send({ type: 'phase', level: 'warn', message: warning });
    // Collect results per issue; report them once the run ends (also when it is stopped part-way).
    const results = new Map<string, any[]>();
    const emit = (ev: any) => {
      if (ev.type === 'result' && ev.ticketId && ev.result) {
        if (!results.has(ev.ticketId)) results.set(ev.ticketId, []);
        results.get(ev.ticketId)!.push({ tcId: ev.tcId, result: ev.result });
      }
      send(ev);
    };
    try {
      await runAutomation({ items, baseUrl, regenerate, project, ai: aiOpts(b), emit, signal, app, user });
    } finally {
      if (results.size && project?.id) {
        try {
          const report = await reportRun({ projectId: project.id, results, runner: user, baseUrl, appUrl: origin });
          send({ type: 'reported', ...report });
        } catch (e: any) {
          console.error('Failure report failed:', e);
          send({ type: 'phase', level: 'warn', message: `Could not post test result comments: ${e.message}` });
        }
      }
    }
    send({ type: 'done' });
  });
});
