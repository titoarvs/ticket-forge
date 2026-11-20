'use client';
import { useEffect } from 'react';
import {
  P,
  S,
  activeSprint,
  saveUi,
  emit,
  type Any,
  can,
  openModal,
  ago,
  mutate,
  feat,
} from '../core';
import { Ico, I, Spinner } from '../ui';
import { runsOnGitHub, collectGitHubRun, runTests, installBrowser } from '../actions';
import { SF, MenuItem, CB, TF } from '../fields';
import { AppSetup } from '../AppSetup';
import { RunSettingsCard } from '../RepoSync';
import { SmartSelectModal } from '../TestSelect';
import { RemoteBrowser } from '../RemoteBrowser';
import { GitHubRunner } from '../GitHubRunner';
import { AUTO_TABS, automationItems, ResultsList } from './automation-items';
import { Header } from './row-dnd';
import { Tile } from './Summary';
import { Failures } from './ShotModal';

export function Automation() {
  const p = P();
  const eng = S.engine,
    run = S.autoRun,
    act = activeSprint();
  const tab = AUTO_TABS.some(([k]) => k === S.autoTab) ? S.autoTab : 'results';
  const setTab = (k: string) => {
    S.autoTab = k;
    saveUi();
    emit();
  };
  const failing = p.tickets.reduce(
    (n: number, t: Any) =>
      n + t.testCases.filter((x: Any) => x.lastRun && x.lastRun.status !== 'Pass').length,
    0,
  );
  const items = automationItems(S.autoScope);
  const all = p.tickets.flatMap((t: Any) => t.testCases);
  const ran = all.filter((x: Any) => x.lastRun);
  const canRun = Boolean(eng?.browser) || runsOnGitHub();
  // A GitHub Actions run that outlived its request: collect its results when the page opens.
  useEffect(() => {
    if (p.automation.ghPending && !S.autoRun?.running) collectGitHubRun();
  }, [p.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <Header
        title="Test automation"
        right={
          can('test.run') &&
          (run?.running ? (
            <button className="btn danger" onClick={() => run.ctrl?.abort()}>
              <Ico svg={I.stop} />
              Stop
            </button>
          ) : (
            <>
              {can('ai.use') && (
                <button
                  className="btn ai"
                  disabled={!canRun}
                  onClick={() => openModal(<SmartSelectModal />)}
                  title="The Test Selection Agent picks the tests worth running for the latest changes"
                >
                  🎯 Smart selection
                </button>
              )}
              <button
                className="btn primary"
                disabled={!items.length || !canRun}
                onClick={() => runTests(items, { regenerate: S.autoRegen })}
              >
                <Ico svg={I.play} />
                Run {items.length} test{items.length === 1 ? '' : 's'}
              </button>
            </>
          ))
        }
      />
      <div className="tabbar auto-tabs" role="tablist" aria-label="Test automation">
        {AUTO_TABS.map(([k, label, icon]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={`tab ${tab === k ? 'active' : ''}`}
            onClick={() => setTab(k)}
          >
            <Ico svg={icon} />
            {label}
            {k === 'failures' && failing > 0 ? (
              <span className="count bad">{failing}</span>
            ) : k === 'setup' ? (
              <span className="count">{(p.automation.app?.pages || []).length}</span>
            ) : null}
          </button>
        ))}
      </div>
      {tab === 'results' && (
        <>
          {!p.automation.baseUrl && (
            <div className="warn-banner" style={{ marginBottom: 12 }}>
              <Ico svg={I.warn} />
              <span>Set the application URL so tests know where to run.</span>
              <button
                className="btn sm"
                style={{ marginLeft: 'auto' }}
                onClick={() => setTab('settings')}
              >
                Open Settings
              </button>
            </div>
          )}
          <div className="tiles">
            <Tile
              icon={I.bot}
              value={`${all.filter((x: Any) => x.script).length} / ${all.length}`}
              label="test cases automated"
            />
            <Tile
              icon={I.check}
              value={ran.filter((x: Any) => x.lastRun.status === 'Pass').length}
              label="passed last run"
              color="#22a06b"
            />
            <Tile
              icon={I.close}
              value={ran.filter((x: Any) => x.lastRun.status === 'Fail').length}
              label="failed last run"
              color="var(--danger)"
            />
            <Tile
              icon={I.clock}
              value={
                ran.length
                  ? ago(
                      ran
                        .map((x: Any) => x.lastRun.at)
                        .sort()
                        .pop(),
                    )
                  : 'Never'
              }
              label="last automated run"
            />
          </div>
          <div className="toolbar">
            <span className="muted small">Run</span>
            <SF
              filter
              aria-label="Which tests"
              value={S.autoScope}
              onChange={(e) => {
                S.autoScope = e.target.value;
                emit();
              }}
            >
              <MenuItem value="all">All test cases</MenuItem>
              <MenuItem value="automated">Tests with scripts</MenuItem>
              <MenuItem value="notrun">Never run</MenuItem>
              <MenuItem value="failed">Failed last run</MenuItem>
              {act && <MenuItem value="sprint">Active sprint ({act.name})</MenuItem>}
              {p.epics.map((e: Any) => (
                <MenuItem key={e.id} value={`epic:${e.id}`}>
                  Epic: {e.title}
                </MenuItem>
              ))}
            </SF>
            {can('ai.use') && (
              <label className="check small">
                <CB
                  checked={S.autoRegen}
                  onChange={(e) => {
                    S.autoRegen = e.target.checked;
                    emit();
                  }}
                />{' '}
                Rewrite existing scripts with Claude
              </label>
            )}
          </div>
          {run && (
            <div className="progress-box" style={{ margin: '0 0 16px' }}>
              {run.running && (
                <div className="pbar">
                  <i />
                </div>
              )}
              <div className="row small" style={{ marginBottom: 6 }}>
                <b>{run.running ? 'Running' : 'Finished'}</b>
                <span className="muted">
                  {run.done} of {run.total} run · {run.pass} passed · {run.fail} failed
                </span>
              </div>
              <ul className="log">
                {run.log.slice(-8).map((l: Any, i: number) => (
                  <li key={i} className={l.level || ''}>
                    {l.level === 'err' || l.level === 'warn' ? (
                      <Ico svg={I.warn} />
                    ) : l.level === 'pass' ? (
                      <Ico svg={I.check} className="ok" />
                    ) : l.level === 'fail' ? (
                      <Ico svg={I.close} style={{ color: 'var(--danger)' }} />
                    ) : l.level === 'info' || !run.running ? (
                      <Ico svg={I.check} className="muted" />
                    ) : (
                      <Spinner />
                    )}
                    <span>{l.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ResultsList items={items} run={run} />
        </>
      )}
      {tab === 'failures' && <Failures />}
      {tab === 'setup' && <AppSetup />}
      {tab === 'settings' && (
        <>
          <RunSettingsCard />
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="grid2" style={{ alignItems: 'end' }}>
              <label className="field" style={{ margin: 0 }}>
                <span>Application URL — where the tests run</span>
                <TF
                  value={p.automation.baseUrl || ''}
                  disabled={!can('project.settings')}
                  placeholder="e.g. http://localhost:3000 or https://staging.example.com"
                  onChange={(e) =>
                    mutate(
                      (pp) => {
                        pp.automation.baseUrl = e.target.value.trim();
                      },
                      { tag: 'baseUrl' },
                    )
                  }
                />
              </label>
              <div className="small">
                {eng ? (
                  eng.browser ? (
                    <span className="row" style={{ gap: 6 }}>
                      <span className="dot ok" />
                      Ready: {eng.label} (Playwright {eng.version}).
                    </span>
                  ) : eng.serverless ? (
                    <span
                      className="row"
                      style={{ gap: 6, flexWrap: 'nowrap', alignItems: 'flex-start' }}
                    >
                      <span className="dot bad" style={{ marginTop: 5 }} />
                      <span>
                        This server can’t run a browser (serverless hosting such as Vercel).{' '}
                        {can('users.manage')
                          ? 'Connect a remote browser below.'
                          : 'Ask an administrator to connect a remote browser.'}
                      </span>
                    </span>
                  ) : (
                    <>
                      <span className="row" style={{ gap: 6 }}>
                        <span className="dot bad" />
                        {eng.installed ? (
                          'No test browser yet: Chromium isn’t installed, and Chrome or Edge wasn’t found.'
                        ) : (
                          <>
                            Playwright is not installed. Run <code>npm install</code>.
                          </>
                        )}
                      </span>
                      {eng.installed && can('users.manage') && (
                        <button
                          className="btn sm"
                          style={{ marginTop: 6 }}
                          onClick={installBrowser}
                        >
                          Install Chromium
                        </button>
                      )}
                    </>
                  )
                ) : (
                  <span className="muted">Checking test engine…</span>
                )}
              </div>
            </div>
            <p className="muted small" style={{ margin: '12px 0 0' }}>
              The AI writes a Playwright script for each test case from its steps, the issue&apos;s
              acceptance criteria, the App setup and snapshots of the app&apos;s pages, using your
              Claude account or, when that isn’t set up, the AI APIs connected in Administration.
              Scripts run headless in the test browser; you can read and edit every script. Results
              update each test case.
            </p>
            <div className="row" style={{ marginTop: 10, gap: 16 }}>
              <span className="small" style={{ fontWeight: 600, color: 'var(--text-subtle)' }}>
                When a test fails
              </span>
              <CB
                label="Comment on the issue"
                disabled={!can('project.settings')}
                checked={p.automation.onFail?.comment !== false}
                onChange={(e: Any) =>
                  mutate((pp) => {
                    pp.automation.onFail = {
                      ...(pp.automation.onFail || {}),
                      comment: e.target.checked,
                    };
                  })
                }
              />
              <CB
                label="Notify the assignee (in-app and email)"
                disabled={!can('project.settings')}
                checked={p.automation.onFail?.notify !== false}
                onChange={(e: Any) =>
                  mutate((pp) => {
                    pp.automation.onFail = {
                      ...(pp.automation.onFail || {}),
                      notify: e.target.checked,
                    };
                  })
                }
              />
              {can('ai.use') && (
                <CB
                  label={
                    <>
                      Self-healing{' '}
                      <span className="muted">
                        (repair scripts broken by page changes, then re-run)
                      </span>
                    </>
                  }
                  disabled={!can('project.settings')}
                  checked={p.automation.selfHeal !== false}
                  onChange={(e: Any) =>
                    mutate((pp) => {
                      pp.automation.selfHeal = e.target.checked;
                    })
                  }
                />
              )}
              {feat('failure-analysis') && can('ai.use') && (
                <CB
                  label={
                    <>
                      Add an AI failure analysis{' '}
                      <span className="muted">(cause, evidence, fix; uses the light model)</span>
                    </>
                  }
                  disabled={!can('project.settings')}
                  checked={p.automation.onFail?.analyze !== false}
                  onChange={(e: Any) =>
                    mutate((pp) => {
                      pp.automation.onFail = {
                        ...(pp.automation.onFail || {}),
                        analyze: e.target.checked,
                      };
                    })
                  }
                />
              )}
            </div>
            <div className="row" style={{ marginTop: 4, gap: 16 }}>
              <span className="small" style={{ fontWeight: 600, color: 'var(--text-subtle)' }}>
                When all of an issue’s tests pass
              </span>
              <CB
                label="Comment on the issue"
                disabled={!can('project.settings')}
                checked={p.automation.onPass?.comment !== false}
                onChange={(e: Any) =>
                  mutate((pp) => {
                    pp.automation.onPass = {
                      ...(pp.automation.onPass || {}),
                      comment: e.target.checked,
                    };
                  })
                }
              />
            </div>
            {(can('project.settings') || can('test.run')) && <GitHubRunner />}
            {can('users.manage') && <RemoteBrowser />}
          </div>
        </>
      )}
    </>
  );
}
