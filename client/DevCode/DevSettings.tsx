'use client';
import { useState, useEffect } from 'react';
import { type Any, runPlace, setRunPlace, toast, api, P } from '../core';
import { SetCard, Ico, I } from '../ui';
import { TF, SF, MenuItem, CB, TA } from '../fields';
import { dev } from './dev';
import { GitHubAccountCard } from './GitHubAccountCard';
import { RepoChooser } from './RepoChooser';
import { setDev } from './FolderPicker';
import { RepoProfile, CodeRabbitCard } from './RepoProfile';
import { BackendRepoCard } from './open-write-code';

/**
 * Project settings → Code & GitHub → Where code jobs run: on this computer (Claude Code next to the
 * checkout) or through your AI provider and the GitHub API (works from the deployed TicketForge;
 * nothing to set up beyond GitHub access).
 */
function CodeRunnerCard({ ed: _ed, env }: { ed: boolean; env: Any }) {
  const d = dev();
  const local = env?.local !== false;
  const onGh = !local || runPlace() === 'github';
  return (
    <SetCard
      id="code-runner"
      title="Where code jobs run"
      desc="Write code with AI either runs a Claude Code agent next to the checkout on this computer, or asks your AI provider for the change and commits it to the issue’s branch through GitHub. The second works from the deployed TicketForge."
    >
      <p className="muted small" style={{ margin: '0 0 8px' }}>
        {local ? (
          <>
            Your choice on this computer, for code jobs <b>and</b> test runs (it’s remembered in
            this browser, not saved in the project). The deployed TicketForge always uses the AI API
            and GitHub.
          </>
        ) : (
          <>This TicketForge is deployed, so code jobs use your AI provider and GitHub.</>
        )}
      </p>
      <div className="rc-sources" role="radiogroup" aria-label="Where code jobs run">
        <button
          role="radio"
          aria-checked={!onGh}
          className={!onGh ? 'on' : ''}
          disabled={!local}
          onClick={() => {
            setRunPlace('local');
            toast('Code jobs and test runs now run on this computer');
          }}
        >
          <Ico svg={I.folder} />
          <b>This computer</b>
          <span className="muted small">
            {local
              ? 'Claude Code next to the repository; live progress; reviews and CodeRabbit.'
              : 'Only when TicketForge runs on your computer (localhost).'}
          </span>
        </button>
        <button
          role="radio"
          aria-checked={onGh}
          className={onGh ? 'on' : ''}
          disabled={!local}
          onClick={() => {
            setRunPlace('github');
            toast('Code jobs now use the AI API and GitHub; test runs use GitHub Actions');
          }}
        >
          <Ico svg={I.pr} />
          <b>AI API + GitHub</b>
          <span className="muted small">
            {local
              ? 'Your AI provider writes the change and TicketForge commits it to the issue’s branch. Works from the deployed app.'
              : 'Used here: this TicketForge is deployed.'}
          </span>
        </button>
      </div>
      {onGh && (
        <div className="crun">
          {!d.repo ? (
            <p className="small muted" style={{ margin: 0 }}>
              Choose the GitHub repository above first.
            </p>
          ) : (
            <div className="ok-banner">
              <Ico svg={I.check} />
              <span>
                Write code with AI works on <b>{d.repo}</b>. It needs an AI provider (Administration
                → AI) and a GitHub connection with write access to the repository; there is nothing
                to install or set up there.
              </span>
            </div>
          )}
          <p className="muted small" style={{ margin: '8px 0 0' }}>
            The AI reads the files that matter for the issue and returns exact edits; TicketForge
            checks each one against the file, then commits to the issue’s branch. It can’t run your
            tests or build, so review the diff before opening the pull request (use the checks on
            the pull request for the rest). It never changes workflow files, <code>.env</code> files
            or lock files.
          </p>
        </div>
      )}
    </SetCard>
  );
}
/** Project settings → Code & GitHub. */
export function DevSettings({ ed }: { ed: boolean }) {
  const d = dev();
  const [env, setEnv] = useState<Any>(null);
  useEffect(() => {
    api(`/api/projects/${P().id}/dev`)
      .then(setEnv)
      .catch(() => setEnv({}));
  }, []);
  return (
    <>
      {env && !env.local && env.saasBlocksLocal && (
        <div className="warn-banner">
          <Ico svg={I.warn} />
          <span>
            This TicketForge runs in hosted mode (<code>TICKETFORGE_MODE=saas</code>), so it treats
            you as deployed even at localhost. Add <code>TICKETFORGE_ALLOW_LOCAL=1</code> to{' '}
            <code>.env</code> and restart to use folders, git and Claude Code on this computer.
          </span>
        </div>
      )}
      {env && !env.local && !env.saasBlocksLocal && (
        <div className="ok-banner">
          <Ico svg={I.check} />
          <span>
            This TicketForge is deployed: choose a GitHub repository and code jobs use your AI
            provider and GitHub (see <b>Where code jobs run</b>). Folders on a computer and cloning
            work when TicketForge runs on your computer.
          </span>
        </div>
      )}
      <GitHubAccountCard ed={ed} env={env} setEnv={setEnv} />
      <SetCard
        id="repo"
        title="Repository"
        desc="Where the code agents work: one of your GitHub repositories, any Git URL, or a folder on this computer. Each issue gets its own branch and git worktree, so the checkout and any uncommitted work are never touched."
      >
        <RepoChooser side="frontend" ed={ed} env={env} setEnv={setEnv} />
        <h4 className="rc-sub">Branches and pull requests</h4>
        <div className="grid2">
          <label className="field">
            <span>Base branch</span>
            <TF
              disabled={!ed}
              value={d.baseBranch || ''}
              placeholder="main"
              spellCheck={false}
              onChange={(e) => setDev('baseBranch', e.target.value.trim())}
            />
          </label>
          <label className="field">
            <span>Branch prefix</span>
            <TF
              disabled={!ed}
              value={d.branchPrefix ?? 'tf/'}
              spellCheck={false}
              onChange={(e) => setDev('branchPrefix', e.target.value.trim())}
            />
            <small className="muted">
              Branches look like <code>{d.branchPrefix ?? 'tf/'}pay-12-short-title</code>
            </small>
          </label>
          <label className="field">
            <span>Claude model</span>
            <SF
              disabled={!ed}
              value={d.model || ''}
              onChange={(e) => setDev('model', e.target.value)}
            >
              <MenuItem value="">Each agent’s own (Administration → Agents)</MenuItem>
              {['opus', 'sonnet', 'haiku'].map((m) => (
                <MenuItem key={m} value={m}>
                  {m} for every agent
                </MenuItem>
              ))}
            </SF>
          </label>
          <label className="field">
            <span>Approvals needed to merge</span>
            <TF
              disabled={!ed}
              type="number"
              min={1}
              max={10}
              value={String(d.requiredApprovals ?? 1)}
              onChange={(e) =>
                setDev(
                  'requiredApprovals',
                  Math.min(10, Math.max(1, Math.floor(Number(e.target.value)) || 1)),
                )
              }
            />
            <small className="muted">
              How many members must approve AI-written code before “Approve and merge” merges its
              pull request (1 to 10).
            </small>
          </label>
        </div>
        <CB
          label="Open pull requests as drafts"
          disabled={!ed}
          checked={d.draft !== false}
          onChange={(e: Any) => setDev('draft', e.target.checked)}
        />
        <details className="rc-adv">
          <summary className="small">Advanced</summary>
          <div className="grid2" style={{ marginTop: 8 }}>
            <label className="field">
              <span>GitHub repository (owner/name)</span>
              <TF
                disabled={!ed}
                value={d.repo || ''}
                placeholder="titoarvs/tito-payroll"
                spellCheck={false}
                onChange={(e) => setDev('repo', e.target.value.trim())}
              />
              <small className="muted">
                Found automatically from the repository; change it only if pull requests should go
                elsewhere.
              </small>
            </label>
          </div>
        </details>
      </SetCard>
      <CodeRunnerCard ed={ed} env={env} />
      <SetCard
        id="agent"
        title="Coding agent"
        desc="What the code agents (Build a Ticket, Feature Tests, Review…) may run and how your team writes code. They read and edit files only in the issue’s worktree; they can’t commit, push, switch branches or browse the web. What each agent does is set in Administration → Agents."
      >
        <label className="field">
          <span>Check command (optional)</span>
          <TF
            disabled={!ed}
            value={d.checkCommand || ''}
            placeholder="e.g. npm test, or npm run lint"
            spellCheck={false}
            onChange={(e) => setDev('checkCommand', e.target.value)}
          />
          <small className="muted">
            The only command it may run, to check its work. Leave empty and it only reads and edits
            code.
          </small>
        </label>
        <label className="field">
          <span>Team conventions</span>
          <TA
            disabled={!ed}
            rows={4}
            value={d.notes || ''}
            placeholder="e.g. Next.js App Router, server actions for writes, Tailwind, tests with Vitest next to the file. Don’t touch the payments module."
            onChange={(e) => setDev('notes', e.target.value)}
          />
        </label>
        <RepoProfile side="frontend" ed={ed} />
      </SetCard>
      <BackendRepoCard ed={ed} local={env?.local !== false} env={env} setEnv={setEnv} />
      <CodeRabbitCard ed={ed} env={env} setEnv={setEnv} />
    </>
  );
}
