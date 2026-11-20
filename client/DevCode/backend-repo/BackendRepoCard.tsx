'use client';
// Project settings → Code & GitHub: a separate backend repository (pull requests on GitHub, merge
// requests on GitLab) and the frontend/backend split of issues.
import { useState } from 'react';
import type { Any } from '../../core';
import { SetCard } from '../../ui';
import { CB } from '../../fields';
import { be, setBe } from '../FolderPicker';
import { RepoChooser } from '../RepoChooser';
import { RepoProfile } from '../RepoProfile';
import { BranchFields } from './branch-fields';
import { GitlabToken } from './gitlab-token';
import { ClassifyLayers } from './classify-layers';

type CardProps = { ed: boolean; local: boolean; env: Any; setEnv: (e: Any) => void };

export function BackendRepoCard({ ed, env, setEnv }: CardProps) {
  const d = be();
  // One busy marker: saving the GitLab token and marking issues don't run at the same time.
  const [busy, setBusy] = useState('');
  const gitlab = d.provider === 'GitLab';
  return (
    <SetCard
      id="backend"
      title="Backend repository"
      desc="For projects whose backend lives in its own repository (GitHub or GitLab). Issues marked Backend run their code agents there, Frontend in the repository above, and Frontend + Backend in both: backend first, then the frontend builds on its API."
    >
      <CB
        label="This project has a separate backend repository"
        disabled={!ed}
        checked={Boolean(d.enabled)}
        onChange={(e: Any) => setBe('enabled', e.target.checked)}
      />
      {d.enabled && (
        <>
          <RepoChooser side="backend" ed={ed} env={env} setEnv={setEnv} />
          <BranchFields ed={ed} gitlab={gitlab} />
          <RepoProfile side="backend" ed={ed} />
          {gitlab ? (
            <GitlabToken ed={ed} env={env} setEnv={setEnv} busy={busy} setBusy={setBusy} />
          ) : (
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              Pull requests use the GitHub account above.
            </p>
          )}
          <ClassifyLayers busy={busy} setBusy={setBusy} />
        </>
      )}
    </SetCard>
  );
}
