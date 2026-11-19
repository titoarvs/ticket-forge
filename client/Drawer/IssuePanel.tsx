'use client';
import { useState } from 'react';
import {
  type Any,
  P,
  can,
  isSub,
  ticket,
  epic,
  childrenOf,
  LINK_TYPES,
  mutate,
  setField,
  clone,
  logChange,
  S,
  toast,
  catOf,
  statusColor,
  statusOf,
  allowedStatuses,
  setMenu,
  openModal,
  emit,
  isDone,
  removeLink,
  addLink,
  newTest,
  logEvent,
  feat,
  ago,
  saveUi,
  me,
  historyText,
  peopleNames,
  addMember,
  PRIORITIES,
  sprint,
  releases,
  release,
  TYPES,
} from '../core';
import {
  Ico,
  I,
  Menu,
  AiRunPicker,
  TypeIcon,
  Avatar,
  StatusLoz,
  PriorityIcon,
  Confirm,
  EmptyState,
  Swatch,
} from '../ui';
import {
  openDrawer,
  duplicateIssue,
  convertToSubtask,
  confirmDeleteIssue,
  runTicketAi,
  AskModal,
  runTests,
  createSubtask,
  refreshPr,
  linkPr,
  saveComment,
} from '../actions';
import { setFlag } from '../RowActions';
import { ProgBar } from '../views';
import { RichTextField, CommentEditor, CommentBody } from '../CommentEditor';
import { codeReady, openCode, openUpdatePr } from '../DevCode';
import { PrFindingChips, openPrFindings } from '../CodeRabbit';
import { TestsSection } from '../TestRepo';
import { TA, SF, opts, TF, MenuItem, PeopleF } from '../fields';
import { VersionHistory } from '../Versions';
import { ReferencesSection } from '../References';
import { useAutoTour } from '../tour';
import { CodeChip, finishedCode } from '../codeStatus';
import { Head, Crumb, prCls } from './Drawer';
import { TestCase } from './TestCase';
import { AutoBody } from './AutoBody';

// ---------------------------------------------------------------- issue
export function IssuePanel({ t }: { t: Any }) {
  useAutoTour('drawer');
  const p = P();
  const edit = can('issue.edit');
  const parent = isSub(t) ? ticket(t.parentId) : null;
  const e = epic((parent || t).epicId);
  const kids = isSub(t) ? [] : childrenOf(t);
  const uncovered = t.acceptanceCriteria
    .map((_: Any, i: number) => i + 1)
    .filter((n: number) => !t.testCases.some((tc: Any) => (tc.acRef || []).includes(n)));
  const sprints = p.sprints.filter((s: Any) => s.state !== 'closed' || s.id === t.sprintId);
  const linkGroups = Object.keys(LINK_TYPES)
    .map((type) => ({
      type,
      items: t.links.filter((l: Any) => l.type === type && ticket(l.targetId)),
    }))
    .filter((g) => g.items.length);
  const field = (k: string, v: Any) => mutate(() => setField(t, k, v), { tag: `t.${k}${t.id}` });
  const setAc = (i: number, v: string) =>
    mutate(
      () => {
        const old = clone(t.acceptanceCriteria);
        t.acceptanceCriteria[i] = v;
        logChange(t, 'acceptanceCriteria', old, t.acceptanceCriteria);
      },
      { tag: `ac${i}${t.id}` },
    );
  const [sub, setSub] = useState('');
  const [link, setLink] = useState({ type: 'blocks', target: '' });
  const [pr, setPr] = useState('');
  const [prBusy, setPrBusy] = useState(false);

  const comments = [...t.comments].sort((a, b) => b.at.localeCompare(a.at));
  const history = [...t.history].sort((a, b) => b.at.localeCompare(a.at));
  const activity =
    S.actTab === 'history'
      ? history.map((h) => ({ kind: 'h', at: h.at, h }))
      : S.actTab === 'all'
        ? [
            ...comments.map((c) => ({ kind: 'c', at: c.at, c })),
            ...history.map((h) => ({ kind: 'h', at: h.at, h })),
          ].sort((a, b) => b.at.localeCompare(a.at))
        : comments.map((c) => ({ kind: 'c', at: c.at, c }));

  return (
    <>
      <Head
        crumb={
          <>
            {e && (
              <>
                <Crumb type="Epic" keyText={e.key} onClick={() => openDrawer('epic', e.id)} />
                <span className="sep">/</span>
              </>
            )}
            {parent && (
              <>
                <Crumb
                  type={parent.type}
                  keyText={parent.key}
                  onClick={() => openDrawer('issue', parent.id)}
                />
                <span className="sep">/</span>
              </>
            )}
            <Crumb type={t.type} keyText={t.key} />
          </>
        }
        menu={
          <>
            {can('issue.create') && (
              <button onClick={() => duplicateIssue(t)}>
                <Ico svg={I.copy} />
                Duplicate
              </button>
            )}
            <button
              onClick={() => {
                navigator.clipboard?.writeText(t.key);
                toast(`Copied ${t.key}`);
              }}
            >
              <Ico svg={I.copy} />
              Copy key
            </button>
            {edit && (
              <button onClick={() => setFlag([t.id], !t.flagged)}>
                <Ico svg={I.flag} />
                {t.flagged ? 'Remove flag' : 'Add flag'}
              </button>
            )}
            {edit && !isSub(t) && (
              <button onClick={() => convertToSubtask(t)}>
                <Ico svg={I.subtask} />
                Convert to sub-task…
              </button>
            )}
            {can('issue.delete') && (
              <>
                <hr />
                <button style={{ color: 'var(--danger)' }} onClick={() => confirmDeleteIssue(t)}>
                  <Ico svg={I.trash} />
                  Delete
                </button>
              </>
            )}
          </>
        }
      />
      <div className="dr-scroll">
        <TA
          title
          rows={1}
          aria-label="Summary"
          disabled={!edit}
          value={t.title}
          onChange={(ev) => field('title', ev.target.value.replace(/\n/g, ' '))}
        />
        <div className="dr-actions">
          <SF
            tone={catOf(t.status)}
            toneColor={statusColor(statusOf(t.status))}
            aria-label="Status"
            disabled={!edit}
            value={t.status}
            onChange={(ev) => field('status', ev.target.value)}
          >
            {opts(allowedStatuses(t))}
          </SF>
          {t.flagged && (
            <span className="flag is-flag" title="Flagged: needs attention">
              <Ico svg={I.flag} />
              Flagged
            </span>
          )}
          {can('ai.use') && edit && (
            <>
              <button
                className="btn ai"
                data-tour="drawer-enhance"
                title="Improve the whole issue"
                onClick={() => runTicketAi(t, 'enhance')}
              >
                <Ico svg={I.sparkle} />
                Enhance
              </button>
              <Menu
                id="drawer-ai"
                left
                button={
                  <button className="btn ai" onClick={() => setMenu('drawer-ai')}>
                    <Ico svg={I.sparkle} />
                    More AI actions
                    <Ico svg={I.chevron} />
                  </button>
                }
              >
                <div className="mh">AI</div>
                <button onClick={() => runTicketAi(t, 'ac')}>Improve acceptance criteria</button>
                <button onClick={() => runTicketAi(t, 'tests')}>Regenerate test cases</button>
                {!isSub(t) && (
                  <button onClick={() => runTicketAi(t, 'split')}>Split into smaller issues</button>
                )}
                <hr />
                <button onClick={() => openModal(<AskModal t={t} />)}>
                  Ask AI to change this issue…
                </button>
              </Menu>
              <AiRunPicker compact />
            </>
          )}
          {t.testCases.length > 0 && can('test.run') && (
            <button
              className="btn"
              data-tour="drawer-tests"
              disabled={S.autoRun?.running}
              title="Run this issue's test cases in a browser"
              onClick={() => runTests(t.testCases.map((tc: Any) => ({ t, tc })))}
            >
              <Ico svg={I.play} />
              Run tests
            </button>
          )}
        </div>
        <div className="dr-cols">
          <div className="dr-main">
            <div className="sec">
              <div className="sec-title">
                <h3>Description</h3>
              </div>
              <RichTextField
                key={t.id}
                ghost
                disabled={!edit}
                text={t.description}
                rich={t.descriptionRich}
                placeholder="Add a description…"
                onChange={(v) =>
                  mutate(
                    () => {
                      setField(t, 'description', v.text);
                      t.descriptionRich = v;
                    },
                    { tag: `t.description${t.id}` },
                  )
                }
              />
            </div>
            <div className="sec">
              <div className="sec-title">
                <h3>User story</h3>
              </div>
              <TA
                ghost
                disabled={!edit}
                value={t.userStory}
                placeholder="As a …, I want …, so that …"
                onChange={(ev) => field('userStory', ev.target.value)}
              />
            </div>

            <div className="sec">
              <div className="sec-title">
                <h3>Acceptance criteria</h3>
                <span className="count">{t.acceptanceCriteria.length}</span>
                {edit && (
                  <div className="tools">
                    <button
                      className="btn sm subtle"
                      onClick={() =>
                        mutate(() => {
                          t.acceptanceCriteria.push('');
                          logChange(t, 'acceptanceCriteria', 0, 1);
                        })
                      }
                    >
                      <Ico svg={I.plus} />
                      Add
                    </button>
                    <button
                      className="btn sm subtle"
                      onClick={() =>
                        mutate(() => {
                          t.acceptanceCriteria.push('Given , when , then ');
                          logChange(t, 'acceptanceCriteria', 0, 1);
                        })
                      }
                    >
                      <Ico svg={I.plus} />
                      Given / When / Then
                    </button>
                  </div>
                )}
              </div>
              {t.acceptanceCriteria.map((a: string, i: number) => (
                <div key={i} className="ac">
                  <span className="ac-n">AC{i + 1}</span>
                  <TA
                    ghost
                    rows={1}
                    style={{ minHeight: 32 }}
                    disabled={!edit}
                    value={a}
                    onChange={(ev) => setAc(i, ev.target.value)}
                  />
                  {edit && (
                    <span className="ops">
                      <button
                        className="icon-btn"
                        title="Move up"
                        disabled={i === 0}
                        onClick={() =>
                          mutate(() => {
                            const l = t.acceptanceCriteria;
                            [l[i], l[i - 1]] = [l[i - 1], l[i]];
                          })
                        }
                      >
                        <Ico svg={I.up} />
                      </button>
                      <button
                        className="icon-btn"
                        title="Move down"
                        disabled={i === t.acceptanceCriteria.length - 1}
                        onClick={() =>
                          mutate(() => {
                            const l = t.acceptanceCriteria;
                            [l[i], l[i + 1]] = [l[i + 1], l[i]];
                          })
                        }
                      >
                        <Ico svg={I.down} />
                      </button>
                      <button
                        className="icon-btn"
                        title="Remove"
                        onClick={() =>
                          mutate(() => {
                            t.acceptanceCriteria.splice(i, 1);
                            logChange(t, 'acceptanceCriteria', 1, 0);
                          })
                        }
                      >
                        <Ico svg={I.trash} />
                      </button>
                    </span>
                  )}
                </div>
              ))}
              {!t.acceptanceCriteria.length && (
                <p className="muted small">No acceptance criteria yet.</p>
              )}
            </div>

            <ReferencesSection t={t} />

            {!isSub(t) && (
              <div className="sec">
                <div className="sec-title">
                  <Ico svg={I.subtask} />
                  <h3>Child issues</h3>
                  <span className="count">{kids.length}</span>
                  {can('issue.create') && (
                    <div className="tools">
                      <button
                        className="btn sm subtle"
                        onClick={() => {
                          S.subForm = true;
                          emit();
                        }}
                      >
                        <Ico svg={I.plus} />
                        Add child issue
                      </button>
                    </div>
                  )}
                </div>
                {kids.length > 0 && (
                  <>
                    <div
                      className="row small muted"
                      style={{ marginBottom: 6, flexWrap: 'nowrap' }}
                    >
                      <ProgBar
                        done={kids.filter(isDone).length}
                        prog={kids.filter((k: Any) => catOf(k.status) === 'inprogress').length}
                        total={kids.length}
                      />
                      <span style={{ whiteSpace: 'nowrap' }}>
                        {Math.round((kids.filter(isDone).length / kids.length) * 100)}% done
                      </span>
                    </div>
                    <div className="rows">
                      {kids.map((k: Any) => (
                        <div key={k.id} className="irow" onClick={() => openDrawer('issue', k.id)}>
                          <TypeIcon type={k.type} />
                          <span className="key">{k.key}</span>
                          <span className="sum">{k.title}</span>
                          <span className="right">
                            <Avatar name={k.assignee} />
                            <StatusLoz s={k.status} />
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {S.subForm && (
                  <div className="inline-form">
                    <span style={{ padding: '0 4px' }}>
                      <TypeIcon type="Sub-task" />
                    </span>
                    <TF
                      bare
                      autoFocus
                      placeholder="What needs to be done?"
                      autoComplete="off"
                      value={sub}
                      onChange={(ev) => setSub(ev.target.value)}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter') {
                          ev.preventDefault();
                          createSubtask(t, sub);
                          setSub('');
                        }
                        if (ev.key === 'Escape') {
                          S.subForm = false;
                          emit();
                        }
                      }}
                    />
                    <button
                      className="btn sm primary"
                      onClick={() => {
                        createSubtask(t, sub);
                        setSub('');
                      }}
                    >
                      Create
                    </button>
                    <button
                      className="btn sm subtle"
                      onClick={() => {
                        S.subForm = false;
                        emit();
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {!kids.length && !S.subForm && (
                  <p className="muted small">Break this issue into smaller pieces of work.</p>
                )}
              </div>
            )}

            <div className="sec">
              <div className="sec-title">
                <Ico svg={I.link} />
                <h3>Linked issues</h3>
                <span className="count">{t.links.length}</span>
                {edit && (
                  <div className="tools">
                    <button
                      className="btn sm subtle"
                      onClick={() => {
                        S.linkForm = true;
                        emit();
                      }}
                    >
                      <Ico svg={I.plus} />
                      Link issue
                    </button>
                  </div>
                )}
              </div>
              {linkGroups.map((g) => (
                <div key={g.type}>
                  <div className="link-type">{g.type}</div>
                  <div className="rows">
                    {g.items.map((l: Any) => {
                      const o = ticket(l.targetId);
                      return (
                        <div key={l.id} className="irow" onClick={() => openDrawer('issue', o.id)}>
                          <TypeIcon type={o.type} />
                          <span className="key">{o.key}</span>
                          <span className="sum">{o.title}</span>
                          <span className="right">
                            <StatusLoz s={o.status} />
                            <PriorityIcon p={o.priority} />
                            {edit && (
                              <button
                                className="icon-btn"
                                title="Remove link"
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  mutate(() => removeLink(t, l.id));
                                }}
                              >
                                <Ico svg={I.close} />
                              </button>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              {S.linkForm && (
                <div className="inline-form" style={{ flexWrap: 'wrap' }}>
                  <SF
                    bare
                    aria-label="Link type"
                    value={link.type}
                    onChange={(ev) => setLink({ ...link, type: ev.target.value })}
                  >
                    {opts(Object.keys(LINK_TYPES))}
                  </SF>
                  <SF
                    bare
                    aria-label="Issue"
                    style={{ flex: 1, minWidth: 200 }}
                    value={link.target}
                    onChange={(ev) => setLink({ ...link, target: ev.target.value })}
                  >
                    <MenuItem value="">Choose an issue…</MenuItem>
                    {p.tickets
                      .filter((x: Any) => x.id !== t.id)
                      .map((o: Any) => (
                        <MenuItem key={o.id} value={o.id}>
                          {o.key} — {o.title.slice(0, 70)}
                        </MenuItem>
                      ))}
                  </SF>
                  <button
                    className="btn sm primary"
                    onClick={() => {
                      const target = ticket(link.target);
                      if (!target) return toast('Choose an issue to link.', 'err');
                      let ok = false;
                      mutate(() => {
                        ok = addLink(t, link.type, target);
                      });
                      S.linkForm = false;
                      emit();
                      toast(
                        ok ? `${t.key} ${link.type} ${target.key}` : 'That link already exists.',
                        ok ? 'ok' : 'err',
                      );
                    }}
                  >
                    Link
                  </button>
                  <button
                    className="btn sm subtle"
                    onClick={() => {
                      S.linkForm = false;
                      emit();
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
              {!t.links.length && !S.linkForm && (
                <p className="muted small">
                  Show which issues block, duplicate or relate to this one.
                </p>
              )}
            </div>

            <div className="sec">
              <div className="sec-title">
                <TypeIcon type="Test" />
                <h3>Test cases</h3>
                <span className="count">{t.testCases.length}</span>
                <div className="tools">
                  {edit && (
                    <button
                      className="btn sm subtle"
                      onClick={() => {
                        const n = newTest();
                        S.openTc.add(n.id);
                        mutate(() => {
                          t.testCases.push(n);
                          logEvent(t, 'added a test case');
                        });
                      }}
                    >
                      <Ico svg={I.plus} />
                      Add
                    </button>
                  )}
                  <button
                    className="btn sm subtle"
                    onClick={() => {
                      t.testCases.forEach((x: Any) => S.openTc.add(x.id));
                      emit();
                    }}
                  >
                    Expand all
                  </button>
                  <button
                    className="btn sm subtle"
                    onClick={() => {
                      t.testCases.forEach((x: Any) => S.openTc.delete(x.id));
                      emit();
                    }}
                  >
                    Collapse all
                  </button>
                </div>
              </div>
              {uncovered.length > 0 && t.testCases.length > 0 && (
                <div className="warn-banner">
                  <Ico svg={I.warn} />
                  <span>
                    Not covered by any test case:{' '}
                    {uncovered.map((n: number) => `AC${n}`).join(', ')}
                  </span>
                </div>
              )}
              {t.testCases.map((tc: Any, i: number) => (
                <TestCase key={tc.id} t={t} tc={tc} i={i} />
              ))}
              {!t.testCases.length && (
                <p className="muted small">
                  No test cases yet. Use “Regenerate test cases” to let Claude write them.
                </p>
              )}
            </div>

            <TestsSection t={t} />
            <div className="sec">
              <div className="sec-title">
                <Ico svg={I.pr} />
                <h3>Development</h3>
                <span className="count">{t.prs.length}</span>
                <CodeChip t={t} />
                {(edit || feat('code')) && (
                  <div className="tools">
                    {/* TF-123: finished code is shown, not rewritten; every member who can open the issue can review and approve it */}
                    {feat('code') && codeReady() && finishedCode(t) && (
                      <button
                        className="btn sm"
                        onClick={() => openCode(t)}
                        title="Review the code, approve it and merge the pull request"
                      >
                        <Ico svg={I.pr} />
                        View code
                      </button>
                    )}
                    {feat('code') && !codeReady() && can('project.settings') && (
                      <a
                        className="btn sm subtle"
                        href={`/p/${P().id}/settings`}
                        onClick={() => {
                          S.setTab = 'code';
                        }}
                        title="Set up the local repository to write code with AI"
                      >
                        Set up code with AI
                      </a>
                    )}
                    {edit && feat('prs') && (
                      <button
                        className="btn sm subtle"
                        onClick={() => {
                          S.prForm = true;
                          emit();
                        }}
                      >
                        <Ico svg={I.plus} />
                        Link pull request
                      </button>
                    )}
                  </div>
                )}
              </div>
              {t.prs.map((r: Any) => (
                <div key={r.id} className="pr-row">
                  <Ico svg={I.pr} />
                  <div className="pr-main">
                    <a href={r.url} target="_blank" rel="noopener noreferrer">
                      {r.title}
                    </a>
                    <div className="muted small">
                      {r.provider} · {r.repo}
                      {r.number ? ` #${r.number}` : ''}
                      {r.branch ? ` · ${r.branch} → ${r.base || ''}` : ''}
                      {r.author ? ` · ${r.author}` : ''}
                      {r.checkedAt ? ` · checked ${ago(r.checkedAt)}` : ''}
                    </div>
                    <PrFindingChips t={t} r={r} />
                  </div>
                  <span className={`loz ${prCls(r.status)}`}>{r.status}</span>
                  {edit &&
                    can('ai.use') &&
                    codeReady() &&
                    ['Open', 'Draft'].includes(r.status) &&
                    ['GitHub', 'GitLab'].includes(r.provider) && (
                      <button
                        className="btn sm ai"
                        title={`Change, enhance or re-describe this ${r.provider === 'GitLab' ? 'merge request' : 'pull request'} with AI`}
                        onClick={() => openUpdatePr(t, r)}
                      >
                        <Ico svg={I.sparkle} />
                        Update
                      </button>
                    )}
                  {['GitHub', 'GitLab'].includes(r.provider) && (
                    <button
                      className="btn sm subtle"
                      title="Read CodeRabbit's review comments on it: fix them with an agent, file them as bugs, or dismiss them"
                      onClick={() => openPrFindings(t, r)}
                    >
                      🐇 CodeRabbit
                    </button>
                  )}
                  {edit && (
                    <>
                      <button
                        className="icon-btn"
                        title="Refresh status"
                        onClick={() => refreshPr(t, r.id)}
                      >
                        <Ico svg={I.refresh} />
                      </button>
                      <button
                        className="icon-btn"
                        title="Unlink"
                        onClick={() =>
                          mutate(() => {
                            t.prs = t.prs.filter((x: Any) => x.id !== r.id);
                            logEvent(t, `unlinked pull request ${r.title}`);
                          })
                        }
                      >
                        <Ico svg={I.close} />
                      </button>
                    </>
                  )}
                </div>
              ))}
              {S.prForm && (
                <div className="inline-form">
                  <TF
                    bare
                    autoFocus
                    placeholder="Paste a GitHub, GitLab or Bitbucket pull request URL"
                    autoComplete="off"
                    value={pr}
                    onChange={(ev) => setPr(ev.target.value)}
                    onKeyDown={async (ev) => {
                      if (ev.key === 'Enter') {
                        ev.preventDefault();
                        setPrBusy(true);
                        if (await linkPr(t, pr)) setPr('');
                        setPrBusy(false);
                      }
                      if (ev.key === 'Escape') {
                        S.prForm = false;
                        emit();
                      }
                    }}
                  />
                  <button
                    className="btn sm primary"
                    disabled={prBusy}
                    onClick={async () => {
                      setPrBusy(true);
                      if (await linkPr(t, pr)) setPr('');
                      setPrBusy(false);
                    }}
                  >
                    {prBusy ? 'Looking up…' : 'Link'}
                  </button>
                  <button
                    className="btn sm subtle"
                    onClick={() => {
                      S.prForm = false;
                      emit();
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
              {!t.prs.length && !S.prForm && (
                <p className="muted small">
                  Link the pull requests that implement this issue to track their status here.
                </p>
              )}
            </div>

            <div className="sec">
              <div className="sec-title">
                <h3>Dependency notes</h3>
              </div>
              <TA
                ghost
                disabled={!edit}
                placeholder="One per line"
                key={t.dependencies.join('|')}
                defaultValue={t.dependencies.join('\n')}
                onBlur={(ev) =>
                  field(
                    'dependencies',
                    ev.target.value
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  )
                }
              />
            </div>

            <div className="sec">
              <div className="sec-title">
                <h3>Activity</h3>
              </div>
              <div className="seg">
                {[
                  ['comments', 'Comments'],
                  ['history', 'History'],
                  ['versions', 'Versions'],
                  ['all', 'All'],
                ].map(([v, l]) => (
                  <button
                    key={v}
                    className={S.actTab === v ? 'on' : ''}
                    aria-pressed={S.actTab === v}
                    onClick={() => {
                      S.actTab = v;
                      saveUi();
                      emit();
                    }}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {S.actTab === 'versions' ? (
                <VersionHistory key={t.id} t={t} />
              ) : (
                <>
                  {S.actTab !== 'history' && can('issue.comment') && (
                    <div className="composer" data-tour="composer">
                      <Avatar name={me()} size={32} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <CommentEditor
                          key={t.id}
                          compactUntilFocus
                          placeholder="Add a comment…"
                          onSave={(v) => saveComment(t, v)}
                        />
                      </div>
                    </div>
                  )}
                  {activity.map((a: Any) =>
                    a.kind === 'c' ? (
                      <div key={a.c.id} className={`comment ${a.c.system ? 'auto' : ''}`}>
                        {a.c.system ? (
                          <span className="avatar bot" title="Automation">
                            <Ico svg={I.bot} />
                          </span>
                        ) : (
                          <Avatar name={a.c.author} size={32} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div>
                            <b>{a.c.author}</b>
                            {a.c.system && (
                              <span className="label-chip" style={{ marginLeft: 6 }}>
                                Automated
                              </span>
                            )}{' '}
                            <span className="muted small">
                              {ago(a.c.at)}
                              {a.c.editedAt ? ' · edited' : ''}
                            </span>
                          </div>
                          {S.cmtEdit === a.c.id ? (
                            <CommentEditor
                              value={a.c}
                              autoFocus
                              onCancel={() => {
                                S.cmtEdit = null;
                                emit();
                              }}
                              onSave={(v) => {
                                S.cmtEdit = null;
                                mutate(() => {
                                  a.c.body = v.text;
                                  a.c.doc = v.doc;
                                  a.c.attachments = v.attachments;
                                  a.c.editedAt = new Date().toISOString();
                                });
                              }}
                            />
                          ) : (
                            <>
                              {a.c.system ? <AutoBody c={a.c} t={t} /> : <CommentBody c={a.c} />}
                              {!a.c.system &&
                                (a.c.authorId
                                  ? a.c.authorId === S.user?.id
                                  : a.c.author === me()) &&
                                can('issue.comment') && (
                                  <div className="row small" style={{ gap: 10, marginTop: 2 }}>
                                    <a
                                      href="#"
                                      onClick={(ev) => {
                                        ev.preventDefault();
                                        S.cmtEdit = a.c.id;
                                        emit();
                                      }}
                                    >
                                      Edit
                                    </a>
                                    <a
                                      href="#"
                                      onClick={(ev) => {
                                        ev.preventDefault();
                                        openModal(
                                          <Confirm
                                            title="Delete this comment?"
                                            label="Delete"
                                            text="The comment is removed from the issue."
                                            onYes={() =>
                                              mutate(() => {
                                                t.comments = t.comments.filter(
                                                  (x: Any) => x.id !== a.c.id,
                                                );
                                              })
                                            }
                                          />,
                                        );
                                      }}
                                    >
                                      Delete
                                    </a>
                                  </div>
                                )}
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div key={a.h.id} className="hist">
                        <Avatar name={a.h.author} size={24} />
                        <div>
                          <b>{a.h.author}</b> {historyText(a.h)}{' '}
                          <span className="muted small">{ago(a.h.at)}</span>
                          {a.h.from !== undefined && (
                            <div className="hist-change">
                              <span>{a.h.from}</span> → <span>{a.h.to}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ),
                  )}
                  {!activity.length &&
                    (S.actTab === 'history' ? (
                      <EmptyState compact icon={I.history} tone="neutral" title="No changes yet">
                        <p>Edits to this issue are recorded here.</p>
                      </EmptyState>
                    ) : (
                      <EmptyState compact icon={I.comment} tone="neutral" title="No comments yet">
                        <p>Start the conversation about this issue below.</p>
                      </EmptyState>
                    ))}
                </>
              )}
            </div>
          </div>

          <div className="dr-side">
            <details
              className="details"
              open={S.detailsOpen}
              onToggle={(ev) => {
                S.detailsOpen = (ev.target as HTMLDetailsElement).open;
                saveUi();
              }}
            >
              <summary>
                Details <Ico svg={I.chevron} />
              </summary>
              <div className="dgrid">
                <span className="label">Assignee</span>
                <div>
                  <span className="with-icon">
                    <Avatar name={t.assignee} />
                    <PeopleF
                      ghost
                      disabled={!edit}
                      value={t.assignee || ''}
                      placeholder="Unassigned"
                      options={peopleNames()}
                      onChange={(v) => field('assignee', v)}
                      onCommit={(v) => v.trim() && mutate(() => addMember(v))}
                    />
                  </span>
                  {edit && t.assignee !== me() && (
                    <a
                      href="#"
                      className="small"
                      style={{ marginLeft: 34 }}
                      onClick={(ev) => {
                        ev.preventDefault();
                        mutate(() => {
                          addMember(me());
                          setField(t, 'assignee', me());
                        });
                      }}
                    >
                      Assign to me
                    </a>
                  )}
                </div>
                <span className="label">Reporter</span>
                <span className="with-icon">
                  <Avatar name={t.reporter} />
                  <PeopleF
                    ghost
                    disabled={!edit}
                    value={t.reporter || ''}
                    placeholder="None"
                    options={peopleNames()}
                    onChange={(v) => field('reporter', v)}
                  />
                </span>
                <span className="label">Labels</span>
                <TF
                  disabled={!edit}
                  key={t.labels.join(',')}
                  defaultValue={t.labels.join(', ')}
                  placeholder="None"
                  onBlur={(ev) =>
                    field(
                      'labels',
                      ev.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    )
                  }
                />
                <span className="label">Priority</span>
                <span className="with-icon">
                  <PriorityIcon p={t.priority} />
                  <SF
                    disabled={!edit}
                    value={t.priority}
                    onChange={(ev) => field('priority', ev.target.value)}
                  >
                    {opts(PRIORITIES)}
                  </SF>
                </span>
                <span className="label">Story points</span>
                <TF
                  type="number"
                  min={0}
                  disabled={!edit}
                  value={t.storyPoints ?? ''}
                  placeholder="None"
                  onChange={(ev) =>
                    field('storyPoints', ev.target.value === '' ? null : Number(ev.target.value))
                  }
                />
                <span className="label">Implementation</span>
                <SF
                  disabled={!edit}
                  value={t.layer || ''}
                  onChange={(ev) => field('layer', ev.target.value || undefined)}
                  aria-label="Implementation"
                >
                  <MenuItem value="">Not set</MenuItem>
                  <MenuItem value="frontend">Frontend</MenuItem>
                  <MenuItem value="backend">Backend</MenuItem>
                  <MenuItem value="both">Frontend + Backend</MenuItem>
                </SF>
                <span className="label">Sprint</span>
                {isSub(t) ? (
                  <span className="muted" style={{ padding: '6px 8px' }}>
                    {sprint(t.sprintId)?.name || 'None'}{' '}
                    <span className="small">(from parent)</span>
                  </span>
                ) : (
                  <SF
                    disabled={!edit && !can('sprint.manage')}
                    value={t.sprintId || ''}
                    onChange={(ev) => field('sprintId', ev.target.value || null)}
                  >
                    <MenuItem value="">None</MenuItem>
                    {sprints.map((s: Any) => (
                      <MenuItem key={s.id} value={s.id}>
                        {s.name}
                        {s.state === 'active'
                          ? ' (active)'
                          : s.state === 'closed'
                            ? ' (closed)'
                            : ''}
                      </MenuItem>
                    ))}
                  </SF>
                )}
                {!isSub(t) && (releases().length > 0 || (t.fixVersions || []).length > 0) && (
                  <>
                    <span className="label">Fix versions</span>
                    <SF
                      multiple
                      disabled={!edit && !can('sprint.manage')}
                      aria-label="Fix versions"
                      value={(t.fixVersions || []).filter((v: string) => release(v))}
                      renderValue={(v: Any) =>
                        v.length ? (
                          <span className="fixv">
                            {v.map((id: string) => (
                              <span
                                key={id}
                                className={`label-chip ${release(id)?.status === 'released' ? 'rel-done' : ''}`}
                              >
                                {release(id)?.name}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="muted">None</span>
                        )
                      }
                      onChange={(ev: Any) => field('fixVersions', ev.target.value)}
                    >
                      {releases()
                        .filter(
                          (r: Any) =>
                            r.status !== 'archived' || (t.fixVersions || []).includes(r.id),
                        )
                        .map((r: Any) => (
                          <MenuItem key={r.id} value={r.id}>
                            {r.name}
                            {r.status !== 'unreleased' ? ` (${r.status})` : ''}
                          </MenuItem>
                        ))}
                    </SF>
                  </>
                )}
                {isSub(t) ? (
                  <>
                    <span className="label">Parent</span>
                    <SF
                      disabled={!edit}
                      value={t.parentId}
                      onChange={(ev) =>
                        mutate(() => {
                          const par = ticket(ev.target.value);
                          setField(t, 'parentId', ev.target.value);
                          if (par) {
                            t.epicId = par.epicId;
                            t.sprintId = par.sprintId;
                          }
                        })
                      }
                    >
                      {p.tickets
                        .filter((x: Any) => !isSub(x))
                        .map((x: Any) => (
                          <MenuItem key={x.id} value={x.id}>
                            {x.key} — {x.title.slice(0, 40)}
                          </MenuItem>
                        ))}
                    </SF>
                  </>
                ) : (
                  <>
                    <span className="label">Epic</span>
                    <span className="with-icon" title={e?.title || undefined}>
                      {e && <Swatch color={e.color} style={{ marginLeft: 4 }} />}
                      <SF
                        disabled={!edit && !can('epic.manage')}
                        value={t.epicId || ''}
                        onChange={(ev) => field('epicId', ev.target.value || null)}
                      >
                        <MenuItem value="">None</MenuItem>
                        {p.epics.map((x: Any) => (
                          <MenuItem key={x.id} value={x.id}>
                            {x.title}
                          </MenuItem>
                        ))}
                      </SF>
                    </span>
                    <span className="label">Issue type</span>
                    <span className="with-icon">
                      <TypeIcon type={t.type} />
                      <SF
                        disabled={!edit}
                        value={t.type}
                        onChange={(ev) => field('type', ev.target.value)}
                      >
                        {opts(TYPES)}
                      </SF>
                    </span>
                  </>
                )}
                <span className="label">Development</span>
                <span className="dev-sum">
                  {t.prs.length ? (
                    <>
                      <Ico svg={I.pr} /> {t.prs.length} pull request{t.prs.length > 1 ? 's' : ''}{' '}
                      {[...new Set(t.prs.map((r: Any) => r.status))].map((s2: Any) => (
                        <span key={s2} className={`loz ${prCls(s2)}`}>
                          {s2}
                        </span>
                      ))}
                    </>
                  ) : edit && feat('prs') ? (
                    <a
                      href="#"
                      className="small"
                      onClick={(ev) => {
                        ev.preventDefault();
                        S.prForm = true;
                        emit();
                      }}
                    >
                      Link pull request
                    </a>
                  ) : (
                    <span className="muted">None</span>
                  )}
                </span>
                <span className="label">Tests</span>
                <span className="dev-sum">
                  {t.testCases.length ? (
                    `${t.testCases.filter((x: Any) => x.status === 'Pass').length}/${t.testCases.length} passing · ${t.testCases.filter((x: Any) => x.script).length} automated`
                  ) : (
                    <span className="muted">None</span>
                  )}
                </span>
              </div>
              <div className="dfoot muted small">
                Created {ago(t.createdAt)} · Updated {ago(t.updatedAt)}
              </div>
            </details>
          </div>
        </div>
      </div>
    </>
  );
}
