// The project's GitHub Actions test runner (Test automation → Settings → GitHub Actions): the repository and branch
// saved on the project, the project's GitHub token (or GITHUB_TOKEN / the `gh` sign-in on this computer) and the
// run key TicketForge shares with that repository's TICKETFORGE_RUN_KEY secret.
import * as store from '@/lib/store';
import { getProjectSecret } from '@/lib/secrets';
import { HttpError } from '@/lib/server/http';

export async function githubRunner(projectId: string | undefined, { deadlineMs = 0 } = {}) {
  if (!projectId) throw new HttpError(400, 'Running on GitHub Actions needs a saved project.');
  const p: any = await store.getProject(projectId);
  const cfg = p?.automation?.github || {};
  if (!cfg.repo) throw new HttpError(400, 'Set up GitHub Actions in Test automation → Settings first.');
  const [token, key] = await Promise.all([getProjectSecret(projectId, 'githubToken'), getProjectSecret(projectId, 'ghRunnerKey')]);
  if (!key) throw new HttpError(400, 'GitHub Actions isn’t set up for this project yet (no run key). Run the setup in Test automation → Settings.');
  return { repo: String(cfg.repo), ref: String(cfg.ref || 'main'), token: token || '', key, deadline: deadlineMs ? Date.now() + deadlineMs : 0 };
}
