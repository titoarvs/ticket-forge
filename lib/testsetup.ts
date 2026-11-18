// Before each test run (Project settings → Database → Before each test run): reset or seed the Test database, so tests
// start from known data. Either a SQL file from the repository, run in one transaction, or an npm script run in the
// repository folder on this computer with DATABASE_URL set to the Test database. Only ever the Test database (or the
// person's own): never Staging or Production.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getSetup, testDatabase, runScript } from './appdb';
import { repoReaders, localRepoDirs, isLocalRequest } from './repo-readers';
import { appEnv } from './childenv';

const NPM_TIMEOUT_MS = 5 * 60_000;
const fail = (message: string) => Object.assign(new Error(message), { status: 400 });
const hide = (text: string, url: string) => {
  let out = String(text || '');
  if (url) { out = out.split(url).join('[test database]'); try { const pw = decodeURIComponent(new URL(url).password); if (pw.length >= 3) out = out.split(pw).join('••••••'); } catch { /* not a URL */ } }
  return out;
};

async function readRepoFile(project: any, file: string) {
  for (const reader of await repoReaders(project)) {
    try { return await reader.read(file); } catch { /* not in this repository */ }
  }
  throw fail(`${file} wasn’t found in the project’s repository. Check the path in Project settings → Database.`);
}

function runNpm(dir: string, script: string, url: string, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(/*turbopackIgnore: true*/ npm, ['run', script], { cwd: dir, env: appEnv(process.env, url), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const keep = (d: any) => { out = (out + d).slice(-4000); };
    child.stdout.on('data', keep); child.stderr.on('data', keep);
    const kill = () => child.kill('SIGTERM');
    const timer = setTimeout(kill, NPM_TIMEOUT_MS);
    signal?.addEventListener('abort', kill);
    child.on('error', (e) => { clearTimeout(timer); reject(fail(`Couldn’t start npm: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', kill);
      if (code === 0) resolve();
      else reject(fail(`npm run ${script} failed${code === null ? ' (stopped or timed out)' : ` (exit code ${code})`}:\n${hide(out.trim().split('\n').slice(-12).join('\n'), url)}`));
    });
  });
}

/**
 * Runs the project's test setup step, reporting progress with emit({ type: 'phase', … }). Does nothing when none is set.
 * Throws when the step fails, so tests don't run on half-prepared data.
 */
export async function runTestSetup({ project, user, emit, signal }: { project: any; user: any; emit: (ev: any) => void; signal?: AbortSignal }) {
  const setup = await getSetup(project.id);
  if (setup.kind === 'none') return;
  const db = await testDatabase(project.id, user?.id, { local: isLocalRequest() });
  if (!db) { emit({ type: 'phase', level: 'warn', message: 'Before the tests: skipped, because the project has no Test database (Project settings → Database).' }); return; }
  const started = Date.now();
  if (setup.kind === 'sql') {
    emit({ type: 'phase', message: `Before the tests: running ${setup.value} on ${db.name}…` });
    const sql = await readRepoFile(project, setup.value);
    if (!sql.trim()) throw fail(`${setup.value} is empty.`);
    await runScript(project.id, db.id, sql, user?.id)
      .catch((e: any) => { throw fail(`Before the tests: ${setup.value} failed on ${db.name}: ${hide(e.message, db.url)}`); });
  } else {
    const dirs = await localRepoDirs(project);
    const dir = dirs.find((d) => { try { return Boolean(JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).scripts?.[setup.value]); } catch { return false; } });
    if (!dir) {
      const why = dirs.length ? `no package.json in the project’s repository has a “${setup.value}” script` : 'npm scripts run only when TicketForge runs on your computer (opened at localhost) with the repository folder set up';
      emit({ type: 'phase', level: 'warn', message: `Before the tests: skipped, because ${why}.` });
      return;
    }
    emit({ type: 'phase', message: `Before the tests: npm run ${setup.value} on ${db.name}…` });
    await runNpm(dir, setup.value, db.url, signal);
  }
  emit({ type: 'phase', message: `Before the tests: done in ${((Date.now() - started) / 1000).toFixed(1)}s.` });
}
