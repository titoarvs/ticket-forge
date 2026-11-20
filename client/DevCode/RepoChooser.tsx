'use client';
// The repository of one side (frontend = the project's main repository, or backend): a summary of
// the one in use (where it is, its branch, its state) and a chooser for a new one from GitHub, a Git
// URL or a local folder. The parts are in client/DevCode/repo-chooser/.
import type { Any } from '../core';
import { Ico, I, Spinner } from '../ui';
import type { Side } from './repo-chooser/repo-facts';
import { type Repo, useRepo } from './repo-chooser/use-repo';
import { CurrentRepo } from './repo-chooser/current-repo';
import { SourceTabs, GitHubForm, UrlForm, FolderForm } from './repo-chooser/source-forms';

type ChooserProps = { side: Side; ed: boolean; env: Any; setEnv: (e: Any) => void };

/** Deployed: folders work only where TicketForge runs, and hosted mode on this computer turns them off. */
function DeployedNotes({ r }: { r: Repo }) {
  if (r.f.local) return null;
  return (
    <>
      {r.env?.saasBlocksLocal && (
        <div className="warn-banner" style={{ marginTop: 8 }}>
          <Ico svg={I.warn} />
          <span>
            You opened TicketForge on this computer, but it is running in hosted mode (
            <code>TICKETFORGE_MODE=saas</code> in <code>.env</code>), which keeps this computer’s
            folders off. To use a folder here, add <code>TICKETFORGE_ALLOW_LOCAL=1</code> to{' '}
            <code>.env</code> (or remove <code>TICKETFORGE_MODE=saas</code>) and restart
            TicketForge.
          </span>
        </div>
      )}
      <p className="small muted" style={{ margin: '8px 0 0' }}>
        Deployed: your GitHub repositories and GitHub URLs are used through GitHub (no copy here);
        folders on a computer work when TicketForge runs on that computer.
      </p>
    </>
  );
}

function Picker({ r, setEnv }: { r: Repo; setEnv: (e: Any) => void }) {
  const keep = () => {
    r.setMode('');
    r.setErr('');
  };
  return (
    <div className="rc-pick">
      <SourceTabs r={r} />
      {r.mode === 'github' && <GitHubForm r={r} setEnv={setEnv} />}
      {r.mode === 'url' && <UrlForm r={r} />}
      {r.mode === 'folder' && <FolderForm r={r} />}
      <DeployedNotes r={r} />
      {r.f.has && r.mode && (
        <button
          className="btn sm subtle"
          style={{ marginTop: 8 }}
          disabled={r.working}
          onClick={keep}
        >
          Keep {r.f.name}
        </button>
      )}
    </div>
  );
}

export function RepoChooser({ side, ed, env, setEnv }: ChooserProps) {
  const r = useRepo(side, ed, env);
  return (
    <div className="rc">
      {r.f.has && !r.mode && <CurrentRepo r={r} />}
      {(r.mode || !r.f.has) && <Picker r={r} setEnv={setEnv} />}
      {r.working && (
        <div className="rp-step small muted">
          <Spinner /> {r.step}
        </div>
      )}
      {r.err && (
        <div className="warn-banner danger" style={{ marginTop: 8 }}>
          <Ico svg={I.warn} />
          <span>{r.err}</span>
        </div>
      )}
    </div>
  );
}
