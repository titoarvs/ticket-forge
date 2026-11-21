// Project settings → GitHub issues → GitHub Project: the boards the linked repository can use, and
// linking one to this project (saved as githubSync.project) or unlinking it. Only the project owner
// and the Super Admin can, like linking the repository.
import { tx } from '../db';
import { HttpError } from '../auth';
import { noteVersion } from '../store';
import { openProject, requireOwner, tokenFor } from '../github-sync';
import { listBoards, readBoard } from './board';

async function ready(user: any, projectId: string) {
  const project = await openProject(user, projectId);
  requireOwner(project);
  if (!project.link?.repo) throw new HttpError(400, 'Link a GitHub repository first.');
  return { link: project.link, token: await tokenFor(projectId) };
}

/** The open boards of the linked repository and its owner. */
export async function boardsFor(user: any, projectId: string) {
  const { link, token } = await ready(user, projectId);
  return { boards: await listBoards(token, link.repo) };
}

async function save(user: any, projectId: string, board: any, text: string) {
  const version = await tx(async (t) => {
    const set = board
      ? "data = jsonb_set(data, '{githubSync,project}', $2::jsonb)"
      : "data = data #- '{githubSync,project}'";
    const pr = (
      await t.query(
        `update projects set version = version + 1, updated_at = now(), ${set},
          revs = revs || jsonb_build_object('githubSync', version + 1)
        where id = $1 and archived_at is null returning version`,
        board ? [projectId, JSON.stringify(board)] : [projectId],
      )
    ).rows[0];
    if (!pr) throw new HttpError(404, 'Project not found');
    await t.query(
      "insert into activity (project_id, version, user_id, author, kind, target, text) values ($1,$2,$3,$4,'project','',$5)",
      [projectId, pr.version, user.id, user.name || '', text],
    );
    return pr.version;
  });
  noteVersion(projectId, version);
}

/** Links a board; which of its fields Ticket Forge maps is saved for the settings to show. */
export async function linkBoard(user: any, projectId: string, boardId: any) {
  const { token } = await ready(user, projectId);
  if (typeof boardId !== 'string' || !/^[\w-]{1,100}$/.test(boardId))
    throw new HttpError(400, 'Pick a GitHub Project.');
  const b = await readBoard(token, boardId);
  const mapped = Object.fromEntries(
    Object.entries(b.fields)
      .filter(([, f]) => f)
      .map(([k, f]: any) => [k, f.name]),
  );
  const board = {
    id: b.id,
    number: b.number,
    title: b.title,
    url: b.url,
    fields: mapped,
    linkedAt: new Date().toISOString(),
    linkedBy: user.name || '',
  };
  await save(user, projectId, board, `linked the GitHub Project “${b.title}”`);
  return { board };
}

export async function unlinkBoard(user: any, projectId: string) {
  const project = await openProject(user, projectId);
  requireOwner(project);
  const title = project.link?.project?.title;
  if (!title) return { ok: true };
  await save(user, projectId, null, `unlinked the GitHub Project “${title}”`);
  return { ok: true };
}
