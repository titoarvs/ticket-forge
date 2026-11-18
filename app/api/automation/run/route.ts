import { api, perm, body, HttpError, aiOpts, ndjson, appUrl } from '@/lib/server/http';
import { engineStatus, runAutomation, noBrowser } from '@/lib/automation';
import { reportRun } from '@/lib/notify';
import { analyzeFailures } from '@/lib/failures';
import { isLocked } from '@/lib/features';
import { resolveAgent } from '@/lib/agents';
import * as store from '@/lib/store';
import { runAppSetup } from '@/lib/server/app-setup';
import { githubRunner } from '@/lib/server/gh-runner';
import { testDatabase, getSetup } from '@/lib/appdb';
import { runTestSetup } from '@/lib/testsetup';
import { isLocalRequest } from '@/lib/repo-readers';

// Driving a browser takes a while: let this run up to 5 minutes on serverless hosting (Vercel).
export const maxDuration = 300;

export const POST = api(async (req) => {
  const user = await perm('test.run');
  const b = await body(req);
  const { items, baseUrl, regenerate, project } = b;
  if (project?.id) await store.requireProject(user, project.id);
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
  // The saved project's app context and database schema go into the AI prompts (the browser sends only a slim project).
  const saved: any = project?.id ? await store.getProject(project.id).catch(() => null) : null;
  if (saved?.appContext) project.appContext = saved.appContext;
  if (saved?.dbSchema) project.dbSchema = saved.dbSchema;
  // Tests that run here can check saved data with app.db.query() on the Test database (read-only). Never on GitHub
  // Actions: the connection string would leave this server.
  const db = saved && !github ? await testDatabase(saved.id, user.id, { local: isLocalRequest() }).catch(() => null) : null;
  if (db) (app as any).db = { url: db.url, engine: db.engine, name: db.name, engineLabel: db.engineLabel, placeholder: db.placeholder };
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
      if (saved && !github) await runTestSetup({ project: saved, user, emit, signal });
      else if (saved && github && (await getSetup(saved.id)).kind !== 'none') send({ type: 'phase', level: 'warn', message: 'Runs on GitHub Actions: the Before each test run step (Project settings → Database) is skipped there.' });
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
