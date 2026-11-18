// The project's repositories as file readers, backend first (that's where schemas, migrations and seeds usually live):
// the person's own folder when TicketForge is opened at localhost on their computer, otherwise the GitHub repository.
import { localReader, githubReader } from './codebase';
import { withMyLocal } from './mylocal';
import { getProjectSecret } from './secrets';
import { SERVERLESS, currentContext } from './db';

const fail = (message: string) => Object.assign(new Error(message), { status: 400 });
export const isLocalRequest = () => !SERVERLESS && Boolean((currentContext() as any).local);

/** The repository folders on this computer, backend first ([] when not opened at localhost). */
export async function localRepoDirs(project: any): Promise<string[]> {
  if (!isLocalRequest()) return [];
  const mine = await withMyLocal(project);
  return [project.devBackend?.enabled ? mine.devBackend?.localPath : '', mine.dev?.localPath].filter(Boolean);
}

export async function repoReaders(project: any) {
  const local = isLocalRequest();
  const mine = local ? await withMyLocal(project) : project;
  const sides = [project.devBackend?.enabled ? mine.devBackend : null, mine.dev].filter(Boolean);
  const out: any[] = [];
  for (const dev of sides) {
    if (local && dev.localPath) { try { out.push(localReader(dev.localPath)); continue; } catch { /* folder gone: try GitHub */ } }
    if (dev.repo && (!dev.provider || dev.provider === 'GitHub')) out.push(await githubReader(dev.repo, { branch: dev.baseBranch || '', token: await getProjectSecret(project.id, 'githubToken') }));
  }
  if (!out.length) throw fail('No repository is set up for this project. Connect one in Project settings → Code & GitHub.');
  return out;
}
