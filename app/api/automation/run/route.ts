import { api, perm, body, HttpError, aiOpts, ndjson, appUrl } from '@/lib/server/http';
import { engineStatus, runAutomation, noBrowser } from '@/lib/automation.js';
import { reportRun } from '@/lib/notify.js';
import { analyzeFailures } from '@/lib/failures.js';
import { isLocked } from '@/lib/features.js';
import { resolveAgent } from '@/lib/agents.js';
import * as store from '@/lib/store.js';
import { runAppSetup } from '@/lib/server/app-setup';
import { githubRunner } from '@/lib/server/gh-runner';

// Driving a browser takes a while: let this run up to 5 minutes on serverless hosting (Vercel).
export const maxDuration = 300;

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
  // GitHub Actions (Test automation → Settings): the browser runs there, so this server doesn't need one.
  const github = b.runOn === 'github' ? await githubRunner(project?.id, { deadlineMs: 260_000 }) : null;
  if (!github && !(await engineStatus()).browser) throw new HttpError(400, noBrowser());
  const origin = appUrl(req);
  // Pages, roles and login settings come from the saved project; passwords only for its saved application URL.
  const { app, warning } = await runAppSetup(project?.id, baseUrl);
  // Testing agents (Administration → Agents): on unless turned off there, AI is locked, or the person can't use AI.
  const aiOk = store.has(user, 'ai.use') && !(await isLocked('ai'));
  const agentOn = async (id: string) => aiOk && (await resolveAgent(id).then((a: any) => a.enabled).catch(() => false));
  const heal = b.heal !== false && await agentOn('self-healing');
  // The saved project's app context goes into the AI prompts (the browser sends only a slim project).
  if (project?.id) { const saved: any = await store.getProject(project.id).catch(() => null); if (saved?.appContext) project.appContext = saved.appContext; }
  const analyzeOn = !(await isLocked('failure-analysis')) && await agentOn('failure-analysis');
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
      await runAutomation({ items, baseUrl, regenerate, project, ai: aiOpts(b), emit, signal, app, user, notes: String(b.notes || '').slice(0, 4000), heal: heal && !github, github });
    } finally {
      if (results.size && project?.id) {
        try {
          // Failure analysis needs the scripts as they ran (written during this run too) and AI use.
          const byTc = new Map<string, any>(items.map((it: any) => [it.tc?.id, it]));
          const analyze = analyzeOn ? (_issueId: string, fails: any[]) => analyzeFailures({
            project, ai: { ...aiOpts(b), onSwitch: (message: string) => send({ type: 'phase', level: 'warn', message }) },
            failures: fails.map((f: any) => ({ ...byTc.get(f.tcId), result: f.result })).filter((f: any) => f.tc && f.ticket),
          }) : null;
          const report = await reportRun({ projectId: project.id, results, runner: user, baseUrl, appUrl: origin, analyze, say: (message: string) => send({ type: 'phase', message }) });
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
