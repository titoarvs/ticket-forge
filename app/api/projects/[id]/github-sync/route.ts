import { api, authed, body, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store';
import { linkRepo, syncIssues } from '@/lib/github-sync';
import { boardsFor, linkBoard, unlinkBoard } from '@/lib/github-project/link';

export const maxDuration = 300;

// Project settings → Code & GitHub → GitHub issues (TF-130): links a GitHub repository and imports
// its issues as tickets. Import-only: no action here writes to GitHub. Only the project owner and
// the Super Admin can (checked in lib/github-sync.ts). Everyone with access sees the link in the
// project's `githubSync` section.
// actions "import" and "sync" (Sync from GitHub) both read the issues and the linked GitHub Project
// board into the tickets. actions "boards", "link-board" { boardId }, "unlink-board": the GitHub
// Project board whose Status, Priority, story points and Sprint ← Iteration are read
// (lib/github-project/); linking a board only saves which one on the Ticket Forge project.
// The former write actions ("create-issue", "push-tickets") are refused with 410 Gone.

/** Actions that used to write to GitHub. */
const WRITES = ['create-issue', 'push-tickets'];
const IMPORT_ONLY =
  'Ticket Forge only imports from GitHub: it doesn’t create, edit or close GitHub issues or change GitHub Projects.';

export const POST = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  const b = await body(req);
  if (b.action === 'link') return linkRepo(user, p.id, b.repo);
  if (b.action === 'import') return syncIssues(user, p.id, 'import');
  if (b.action === 'sync') return syncIssues(user, p.id, 'sync');
  if (b.action === 'boards') return boardsFor(user, p.id);
  if (b.action === 'link-board') return linkBoard(user, p.id, b.boardId);
  if (b.action === 'unlink-board') return unlinkBoard(user, p.id);
  if (WRITES.includes(b.action)) throw new HttpError(410, IMPORT_ONLY);
  throw new HttpError(
    400,
    'Send an action: link, import, sync, boards, link-board or unlink-board.',
  );
});
