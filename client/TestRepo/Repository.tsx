'use client';
import { useState, type ReactNode } from 'react';
import { P, type Any, uid, openModal, toast, can } from '../core';
import { Ico, I, TypeIcon, Confirm, EmptyState } from '../ui';
import { TF, SF, MenuItem } from '../fields';
import { openDrawer } from '../actions';
import { repo, edit } from './run-status';
import { wfOf, canEdit, WF, latestRun, WfLoz, RunLoz } from './TestManagement';
import { AiWriteModal } from './record-automation-result';
import { openTest, ImportModal } from './open-test';
import { exportTestsCsv } from './TestsSection';
import { CsvImportModal } from './CsvImportModal';

// ---------------------------------------------------------------- repository
export function Repository() {
  const p = P();
  const r = repo(p);
  const [folder, setFolder] = useState<string>('all');
  const [q, setQ] = useState('');
  const [newFolder, setNewFolder] = useState<string | null>(null);
  // Epics view (default): the tree follows the backlog — epic → its issues — from the issues each
  // test covers.
  const [mode, setModeState] = useState<string>(() => {
    try {
      return localStorage.getItem('tf.repoMode') || 'epics';
    } catch {
      return 'epics';
    }
  });
  const setMode = (m: string) => {
    setModeState(m);
    setFolder('all');
    try {
      localStorage.setItem('tf.repoMode', m);
    } catch {
      /* private mode */
    }
  };
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const issueOf = (id: string) => p.tickets.find((x: Any) => x.id === id);
  const epicsOf = (t: Any) => {
    const ids = new Set((t.issueIds || []).map((id: string) => issueOf(id)?.epicId || 'none'));
    if (!ids.size) ids.add('none');
    return ids;
  };
  const inFolder = (t: Any) => {
    if (folder === 'all') return true;
    if (mode === 'epics') {
      if (folder.startsWith('epic:')) return epicsOf(t).has(folder.slice(5));
      if (folder.startsWith('issue:')) return (t.issueIds || []).includes(folder.slice(6));
      if (folder === 'unlinked') return !(t.issueIds || []).length;
      return true;
    }
    return folder === 'none' ? !t.folderId : t.folderId === folder;
  };
  const [wf, setWf] = useState('');
  const list = r.tests
    .filter(inFolder)
    .filter((t: Any) => (!wf ? wfOf(t) !== 'Deprecated' : wf === 'all' || wfOf(t) === wf))
    .filter(
      (t: Any) =>
        !q.trim() ||
        `${t.key} ${t.title} ${t.labels?.join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()),
    );
  const tree = (parentId: string | null, depth: number): ReactNode =>
    r.folders
      .filter((f: Any) => (f.parentId || null) === parentId)
      .map((f: Any) => (
        <div key={f.id}>
          <button
            className={`xr-folder ${folder === f.id ? 'on' : ''}`}
            style={{ paddingLeft: 10 + depth * 14 }}
            title={f.name}
            onClick={() => setFolder(f.id)}
          >
            <Ico svg={I.folder} />
            <span>{f.name}</span>
            <span className="count">{r.tests.filter((t: Any) => t.folderId === f.id).length}</span>
          </button>
          {tree(f.id, depth + 1)}
        </div>
      ));
  const addFolder = () => {
    const name = String(newFolder || '').trim();
    if (!name) {
      setNewFolder(null);
      return;
    }
    const parentId = folder !== 'all' && folder !== 'none' ? folder : null;
    edit((rr) => {
      rr.folders.push({ id: uid(), name, parentId });
    });
    setNewFolder(null);
  };
  const cur = mode === 'folders' ? r.folders.find((f: Any) => f.id === folder) : null;
  const selIssue = folder.startsWith('issue:') ? issueOf(folder.slice(6)) : null;
  const epicTree = () => {
    const rows = [
      ...p.epics.map((e: Any) => ({ id: e.id, label: `${e.key} ${e.title}`, color: e.color })),
      { id: 'none', label: 'No epic', color: '' },
    ]
      .map((e: Any) => ({
        ...e,
        tests: r.tests.filter((t: Any) => (t.issueIds || []).length && epicsOf(t).has(e.id)),
      }))
      .filter((e: Any) => e.tests.length);
    return rows.map((e: Any) => {
      const issues = p.tickets.filter(
        (x: Any) =>
          (e.id === 'none' ? !x.epicId : x.epicId === e.id) &&
          r.tests.some((t: Any) => t.issueIds?.includes(x.id)),
      );
      const isOpen = open[e.id] ?? folder === `epic:${e.id}`;
      return (
        <div key={e.id}>
          <div className="xr-epicrow">
            <button
              className="xr-caret"
              aria-label={isOpen ? 'Collapse' : 'Expand'}
              aria-expanded={isOpen}
              onClick={() => setOpen({ ...open, [e.id]: !isOpen })}
            >
              <Ico svg={I.chevron} className={isOpen ? '' : 'closed'} />
            </button>
            <button
              className={`xr-folder ${folder === `epic:${e.id}` ? 'on' : ''}`}
              title={e.label}
              onClick={() => {
                setFolder(`epic:${e.id}`);
                setOpen({ ...open, [e.id]: true });
              }}
            >
              {e.color ? (
                <span className="xr-swatch" style={{ background: e.color }} />
              ) : (
                <Ico svg={I.epic} />
              )}
              <span>{e.label}</span>
              <span className="count">{e.tests.length}</span>
            </button>
          </div>
          {isOpen &&
            issues.map((x: Any) => (
              <button
                key={x.id}
                className={`xr-folder xr-issuerow ${folder === `issue:${x.id}` ? 'on' : ''}`}
                title={`${x.key} ${x.title}`}
                onClick={() => setFolder(`issue:${x.id}`)}
              >
                <TypeIcon type={x.type} />
                <span>
                  <b className="key">{x.key}</b> {x.title}
                </span>
                <span className="count">
                  {r.tests.filter((t: Any) => t.issueIds?.includes(x.id)).length}
                </span>
              </button>
            ))}
        </div>
      );
    });
  };
  /**
   * Rebuilds the folders to match the epics: one folder per epic, each test in the folder of its
   * (first) issue's epic.
   */
  const sortIntoEpicFolders = () =>
    openModal(
      <Confirm
        title="Sort tests into epic folders?"
        label="Sort into epic folders"
        text="Each test moves to a folder named after its epic (created when missing). Tests with no issue or no epic go to “No epic”. Other folders stay, possibly empty."
        onYes={() => {
          let moved = 0;
          edit((rr, pp) => {
            const folderFor = (name: string) => {
              let f = rr.folders.find((x: Any) => x.name === name && !x.parentId);
              if (!f) {
                f = { id: uid(), name, parentId: null };
                rr.folders.push(f);
              }
              return f.id;
            };
            for (const t of rr.tests) {
              const ep = pp.epics.find(
                (e: Any) =>
                  e.id === pp.tickets.find((x: Any) => x.id === (t.issueIds || [])[0])?.epicId,
              );
              const id = folderFor(ep ? `${ep.key} ${ep.title}` : 'No epic');
              if (t.folderId !== id) {
                t.folderId = id;
                moved++;
              }
            }
            // epic folders in backlog order, then the rest
            const order = new Map<string, number>(
              pp.epics.map((e: Any, i: number) => [`${e.key} ${e.title}`, i] as [string, number]),
            );
            rr.folders.sort(
              (a: Any, b: Any) => (order.get(a.name) ?? 1e6) - (order.get(b.name) ?? 1e6),
            );
          });
          toast(`${moved} test${moved === 1 ? '' : 's'} moved into epic folders.`, 'ok', {
            title: 'Repository organized',
          });
        }}
      />,
    );
  return (
    <div className="xr-repo">
      <aside className="xr-tree">
        <div className="xr-mode" role="tablist" aria-label="Organize by">
          <button
            role="tab"
            aria-selected={mode === 'epics'}
            className={mode === 'epics' ? 'on' : ''}
            onClick={() => setMode('epics')}
          >
            Epics
          </button>
          <button
            role="tab"
            aria-selected={mode === 'folders'}
            className={mode === 'folders' ? 'on' : ''}
            onClick={() => setMode('folders')}
          >
            Folders
          </button>
        </div>
        <button
          className={`xr-folder ${folder === 'all' ? 'on' : ''}`}
          onClick={() => setFolder('all')}
        >
          <Ico svg={I.test} />
          <span>All tests</span>
          <span className="count">{r.tests.length}</span>
        </button>
        {mode === 'epics' && (
          <>
            {epicTree()}
            {r.tests.some((t: Any) => !(t.issueIds || []).length) && (
              <button
                className={`xr-folder ${folder === 'unlinked' ? 'on' : ''}`}
                onClick={() => setFolder('unlinked')}
              >
                <Ico svg={I.doc} />
                <span>Not linked to an issue</span>
                <span className="count">
                  {r.tests.filter((t: Any) => !(t.issueIds || []).length).length}
                </span>
              </button>
            )}
            {canEdit() && r.tests.length > 0 && (
              <button
                className="btn sm subtle"
                onClick={sortIntoEpicFolders}
                title="Make the folders match the epics"
              >
                <Ico svg={I.folder} />
                Sort into epic folders
              </button>
            )}
          </>
        )}
        {mode === 'folders' && tree(null, 0)}
        {mode === 'folders' && (
          <button
            className={`xr-folder ${folder === 'none' ? 'on' : ''}`}
            onClick={() => setFolder('none')}
          >
            <Ico svg={I.doc} />
            <span>Not in a folder</span>
            <span className="count">{r.tests.filter((t: Any) => !t.folderId).length}</span>
          </button>
        )}
        {mode === 'folders' &&
          canEdit() &&
          (newFolder !== null ? (
            <div className="xr-newfolder">
              <TF
                autoFocus
                value={newFolder}
                placeholder={cur ? `Folder inside ${cur.name}` : 'Folder name'}
                onChange={(e) => setNewFolder(e.target.value)}
                onKeyDown={(e: Any) => {
                  if (e.key === 'Enter') addFolder();
                  if (e.key === 'Escape') setNewFolder(null);
                }}
                onBlur={addFolder}
              />
            </div>
          ) : (
            <button className="btn sm subtle" onClick={() => setNewFolder('')}>
              <Ico svg={I.plus} />
              New folder{cur ? ' here' : ''}
            </button>
          ))}
        {cur && canEdit() && (
          <button
            className="btn sm subtle"
            onClick={() =>
              openModal(
                <Confirm
                  title={`Delete the folder “${cur.name}”?`}
                  label="Delete folder"
                  text="Its tests and sub-folders move up to the parent folder. No test is deleted."
                  onYes={() => {
                    edit((rr) => {
                      rr.tests.forEach((t: Any) => {
                        if (t.folderId === cur.id) t.folderId = cur.parentId || null;
                      });
                      rr.folders.forEach((f: Any) => {
                        if (f.parentId === cur.id) f.parentId = cur.parentId || null;
                      });
                      rr.folders = rr.folders.filter((f: Any) => f.id !== cur.id);
                    });
                    setFolder('all');
                  }}
                />,
              )
            }
          >
            <Ico svg={I.trash} />
            Delete folder
          </button>
        )}
      </aside>
      <section className="xr-list">
        <div className="toolbar">
          <TF
            search
            sx={{ width: 260, maxWidth: '100%' }}
            placeholder="Search tests"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <SF
            filter
            value={wf}
            onChange={(e) => setWf(e.target.value)}
            aria-label="Workflow status"
          >
            <MenuItem value="">Active (not deprecated)</MenuItem>
            {WF.map((x) => (
              <MenuItem key={x} value={x}>
                {x} ({r.tests.filter((t: Any) => wfOf(t) === x).length})
              </MenuItem>
            ))}
            <MenuItem value="all">All</MenuItem>
          </SF>
          <span className="spacer" />
          {canEdit() && can('ai.use') && (
            <button
              className="btn sm ai"
              onClick={() => openModal(<AiWriteModal scope={folder} folderId={cur?.id || null} />)}
              title="The AI writes repository tests for issues, following your test standard (Administration → Generation)"
            >
              <Ico svg={I.sparkle} />
              Write tests with AI
            </button>
          )}
          {selIssue && canEdit() && (
            <button className="btn sm" onClick={() => openTest(null, null, selIssue.id)}>
              <Ico svg={I.plus} />
              New test for {selIssue.key}
            </button>
          )}
          <button
            className="btn sm subtle"
            onClick={() => exportTestsCsv(list)}
            title="Export these tests as CSV (one row per step: Xray / BrowserStack style)"
          >
            <Ico svg={I.download} />
            Export CSV
          </button>
          {canEdit() && (
            <button
              className="btn sm subtle"
              onClick={() => openModal(<CsvImportModal folderId={cur?.id || null} />)}
            >
              <Ico svg={I.upload} />
              Import CSV
            </button>
          )}
          {canEdit() && (
            <button
              className="btn sm"
              onClick={() => openModal(<ImportModal folderId={cur?.id || null} />)}
            >
              <Ico svg={I.upload} />
              Import from issues
            </button>
          )}
        </div>
        {list.length ? (
          <table className="tbl xr-tests">
            <thead>
              <tr>
                <th>Key</th>
                <th>Test</th>
                <th>Status</th>
                <th>Type</th>
                <th>Steps</th>
                <th>Issues</th>
                <th>Latest result</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t: Any) => {
                const lr = latestRun(t.id);
                return (
                  <tr key={t.id} className="click" onClick={() => openTest(t)}>
                    <td className="key">{t.key}</td>
                    <td>
                      {t.title}
                      {t.labels?.length ? (
                        <span className="lbls">
                          {t.labels.slice(0, 2).map((l: string) => (
                            <span key={l} className="label-chip">
                              {l}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <WfLoz t={t} />
                      {(t.version || 1) > 1 && <span className="muted small"> v{t.version}</span>}
                    </td>
                    <td className="muted">{t.type}</td>
                    <td className="num muted">{t.steps?.length || 0}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {(t.issueIds || [])
                        .map((id: string) => p.tickets.find((x: Any) => x.id === id))
                        .filter(Boolean)
                        .slice(0, 3)
                        .map((x: Any) => (
                          <button
                            key={x.id}
                            className="link-btn key small"
                            onClick={() => openDrawer('issue', x.id)}
                          >
                            {x.key}
                          </button>
                        ))}
                      {(t.issueIds || []).length > 3 ? (
                        <span className="muted small"> +{t.issueIds.length - 3}</span>
                      ) : null}
                    </td>
                    <td>
                      {lr ? (
                        <>
                          <RunLoz s={lr.status} />{' '}
                          <span className="muted small">{lr.execution.key}</span>
                        </>
                      ) : (
                        <span className="muted small">Not run</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState
            compact
            icon={I.test}
            tone="neutral"
            title={r.tests.length ? 'No tests here' : 'No tests yet'}
            actions={
              canEdit() && (
                <>
                  <button className="btn primary" onClick={() => openTest(null, cur?.id)}>
                    <Ico svg={I.plus} />
                    New test
                  </button>
                  {!r.tests.length && (
                    <button
                      className="btn"
                      onClick={() => openModal(<ImportModal folderId={null} />)}
                    >
                      <Ico svg={I.upload} />
                      Import from issues
                    </button>
                  )}
                </>
              )
            }
          >
            <p>
              {r.tests.length
                ? 'Pick another folder, or clear the search.'
                : 'Create reusable tests, or import the test cases your issues already have. Each test can cover several issues.'}
            </p>
          </EmptyState>
        )}
      </section>
    </div>
  );
}
