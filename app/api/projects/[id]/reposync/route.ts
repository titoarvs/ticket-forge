import { api, authed, body, HttpError, aiOpts, ndjson } from '@/lib/server/http';
import * as store from '@/lib/store';
import { SERVERLESS, currentContext } from '@/lib/db';
import {
  readRepo,
  testCaseUpdates,
  builtFeatures,
  pageTestCases,
  builtFeatureMap,
} from '@/lib/reposync';

export const maxDuration = 300;

// Test automation → Sync with the repository (lib/reposync.ts). Streams progress; returns pages,
// test-case updates and already-built features for review. Nothing is saved here.
export const POST = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  if (!store.has(user, 'project.settings'))
    throw new HttpError(403, 'Syncing with the repository needs the Project settings permission.');
  if (SERVERLESS || !(currentContext() as any).local)
    throw new HttpError(
      400,
      'Reading the local repository works only when TicketForge runs on your computer (opened at localhost).',
    );
  const b = await body(req);
  const project = await store.getProject(p.id);
  const dir = String(
    project.dev?.localPath ||
      (project.automation?.app?.source?.kind === 'folder'
        ? project.automation.app.source.location
        : '') ||
      '',
  ).trim();
  if (!dir)
    throw new HttpError(
      400,
      'Set the local repository folder in Project settings → Code & GitHub first.',
    );
  const wantTests = b.testCases !== false && store.has(user, 'ai.use');
  const wantBacklog =
    b.backlog !== false && store.has(user, 'ai.use') && store.has(user, 'issue.create');
  if (b.mode === 'features') {
    // Everything already built (pages, Markdown docs, history), organized into epics, for review.
    if (!store.has(user, 'ai.use') || !store.has(user, 'issue.create'))
      throw new HttpError(
        403,
        'Mapping built features uses the AI and creates issues, which your role does not allow.',
      );
    return ndjson(req, async (send, signal) => {
      const say = (message: string) => send({ type: 'progress', message });
      // The backend repository too (Project settings → Code & GitHub → Backend), for its endpoints
      // and data models.
      const backendDir = project.devBackend?.enabled
        ? String(project.devBackend.localPath || '').trim()
        : '';
      send({
        type: 'done',
        result: await builtFeatureMap({
          project,
          dir,
          backendDir,
          ai: { ...aiOpts(b), signal },
          emit: say,
        }),
      });
    });
  }
  if (b.mode === 'pageTests') {
    // Test cases for the existing pages, written from their code.
    if (!store.has(user, 'ai.use'))
      throw new HttpError(403, 'Writing test cases uses the AI, which your role does not allow.');
    return ndjson(req, async (send, signal) => {
      const say = (message: string) => send({ type: 'progress', message });
      say(`Reading ${dir}…`);
      const only = Array.isArray(b.pages) ? b.pages.map(String) : null;
      send({
        type: 'done',
        result: await pageTestCases({
          project,
          dir,
          only,
          ai: { ...aiOpts(b), signal },
          emit: say,
        }),
      });
    });
  }
  return ndjson(req, async (send, signal) => {
    const say = (message: string) => send({ type: 'progress', message });
    say(`Reading ${dir}…`);
    const repo = await readRepo(dir, project.automation?.repoSync?.sha || null);
    const changed = repo.pages.filter((x: any) => x.changedFiles.length).length;
    say(
      `Found ${repo.pages.length} pages (${repo.frameworks.join(', ') || 'no router recognised'}) on ${repo.branch}; ${changed} changed — ${repo.baseNote}.`,
    );
    const ai = { ...aiOpts(b), signal };
    const tests = wantTests
      ? await testCaseUpdates({ project, repo, ai, emit: say }).catch((e: any) => {
          say(`Couldn’t check the test cases: ${e.message}`);
          return { updates: [], additions: [], error: e.message };
        })
      : { updates: [], additions: [] };
    const built = wantBacklog
      ? await builtFeatures({ project, repo, ai, emit: say }).catch((e: any) => {
          say(`Couldn’t match the history with the backlog: ${e.message}`);
          return { done: [], newIssues: [], error: e.message };
        })
      : { done: [], newIssues: [] };
    send({
      type: 'done',
      result: {
        repo: {
          root: repo.root,
          branch: repo.branch,
          head: repo.head,
          base: repo.base,
          baseNote: repo.baseNote,
          frameworks: repo.frameworks,
          changedFiles: repo.changedFiles,
          sharedChanged: repo.sharedChanged,
          uncommitted: repo.uncommitted,
          commits: repo.log.length,
        },
        pages: repo.pages.map(({ diff, depFiles, ...x }: any) => x),
        tests,
        built,
      },
    });
  });
});
