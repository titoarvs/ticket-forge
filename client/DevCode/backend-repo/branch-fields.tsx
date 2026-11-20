'use client';
// The backend repository's branches and pull requests: its name, base branch, branch prefix, check
// command and conventions.
import { TF, TA } from '../../fields';
import { be, setBe } from '../FolderPicker';
import { dev } from '../dev';

export function BranchFields({ ed, gitlab }: { ed: boolean; gitlab: boolean }) {
  const d = be();
  return (
    <>
      <h4 className="rc-sub">Branches and pull requests</h4>
      <div className="grid2">
        <label className="field">
          <span>{gitlab ? 'GitLab project (group/name)' : 'GitHub repository (owner/name)'}</span>
          <TF
            disabled={!ed}
            value={d.repo || ''}
            placeholder={gitlab ? 'tito-solutions/hris/tito-hris-api' : 'owner/my-app-api'}
            spellCheck={false}
            onChange={(e) => setBe('repo', e.target.value.trim())}
          />
          <small className="muted">
            Found automatically from the repository. Pull requests open{' '}
            {gitlab ? 'as GitLab merge requests' : 'on GitHub'}.
          </small>
        </label>
        <label className="field">
          <span>Base branch</span>
          <TF
            disabled={!ed}
            value={d.baseBranch || ''}
            placeholder="develop"
            spellCheck={false}
            onChange={(e) => setBe('baseBranch', e.target.value.trim())}
          />
        </label>
        <label className="field">
          <span>Branch prefix</span>
          <TF
            disabled={!ed}
            value={d.branchPrefix ?? dev().branchPrefix ?? 'tf/'}
            spellCheck={false}
            onChange={(e) => setBe('branchPrefix', e.target.value.trim())}
          />
        </label>
        <label className="field">
          <span>Check command (optional)</span>
          <TF
            disabled={!ed}
            value={d.checkCommand || ''}
            placeholder="e.g. npm test"
            spellCheck={false}
            onChange={(e) => setBe('checkCommand', e.target.value)}
          />
        </label>
      </div>
      <label className="field">
        <span>Backend conventions</span>
        <TA
          disabled={!ed}
          rows={3}
          value={d.notes || ''}
          placeholder="e.g. Express + Drizzle, routes in src/routes, migrations with drizzle-kit, Vitest tests next to the file. Never edit existing migrations."
          onChange={(e) => setBe('notes', e.target.value)}
        />
      </label>
    </>
  );
}
