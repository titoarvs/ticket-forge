'use client';
import { type Any, can, openModal, mutate, feat, fmtDate, P, COLORS, spSum } from '../core';
import { Ico, I, TypeIcon, Avatar, StatusLoz, PriorityIcon } from '../ui';
import { DeleteEpicModal, CreateIssueModal, NewWithClaudeModal, openDrawer } from '../actions';
import { epicProgress, ProgBar } from '../views';
import { epicRange, setEpicDates } from '../Timeline';
import { openSpecs } from '../Specs';
import { openDevOrder, canWriteCode, epicCodeIds, openBulkCode } from '../DevPlan';
import { openSplitIssues } from '../Split';
import { TA, DateF } from '../fields';
import { DraftBanner, DraftReference } from '../EpicDrafts';
import { EpicDocSections } from '../EpicDocs';
import { Head, Crumb } from './Drawer';

// ---------------------------------------------------------------- epic
export function EpicPanel({ e }: { e: Any }) {
  const pr = epicProgress(e);
  const ed = can('epic.manage');
  const range = epicRange(e);
  return (
    <>
      <Head
        crumb={<Crumb type="Epic" keyText={e.key} />}
        menu={
          ed ? (
            <button
              style={{ color: 'var(--danger)' }}
              onClick={() => openModal(<DeleteEpicModal ep={e} />)}
            >
              <Ico svg={I.trash} />
              Delete epic
            </button>
          ) : (
            <span className="muted small" style={{ padding: '8px 16px', display: 'block' }}>
              No actions available
            </span>
          )
        }
      />
      <div className="dr-scroll">
        {e.draft && <DraftBanner e={e} />}
        <TA
          title
          rows={1}
          aria-label="Epic name"
          disabled={!ed}
          value={e.title}
          onChange={(ev) =>
            mutate(
              () => {
                e.title = ev.target.value.replace(/\n/g, ' ');
              },
              { tag: `e.title${e.id}` },
            )
          }
        />
        <div className="dr-actions">
          {can('issue.create') && (
            <button className="btn" onClick={() => openModal(<CreateIssueModal epicId={e.id} />)}>
              <Ico svg={I.plus} />
              Create issue
            </button>
          )}
          {can('issue.create') && can('ai.use') && (
            <button
              className="btn ai"
              onClick={() => openModal(<NewWithClaudeModal epicId={e.id} />)}
            >
              <Ico svg={I.sparkle} />
              Write issue with Claude
            </button>
          )}
          {can('issue.create') && can('ai.use') && feat('split') && (
            <button
              className="btn"
              onClick={() => openSplitIssues(e.id)}
              title="Split this epic’s issues into smaller ones"
            >
              <Ico svg={I.subtask} />
              Split issues
            </button>
          )}
          <button
            className="btn"
            onClick={() => openSpecs(e)}
            title="One coding prompt per issue, with the files it touches and overlaps between issues"
          >
            <Ico svg={I.doc} />
            Coding specs
          </button>
          <button
            className="btn"
            onClick={() => openDevOrder({ epicId: e.id, title: e.title })}
            title="The order to build this epic’s issues in, with a reason for each"
          >
            <Ico svg={I.up} />
            Development order
          </button>
          {canWriteCode() && epicCodeIds(e.id).length > 0 && (
            <button
              className="btn ai"
              onClick={() => openBulkCode(epicCodeIds(e.id))}
              title="One code job per open issue of this epic, checked for issues that touch the same code first"
            >
              <Ico svg={I.sparkle} />
              Write code for epic
            </button>
          )}
        </div>
        <div className="sec">
          <div className="sec-title">
            <h3>Description</h3>
          </div>
          <TA
            ghost
            disabled={!ed}
            value={e.description}
            placeholder="Describe the goal of this epic…"
            onChange={(ev) =>
              mutate(
                () => {
                  e.description = ev.target.value;
                },
                { tag: `e.desc${e.id}` },
              )
            }
          />
        </div>
        <DraftReference e={e} />
        {feat('docs') && <EpicDocSections epic={e} />}
        <div className="sec">
          <div className="sec-title">
            <h3>Dates</h3>
            {range?.derived && (
              <span className="muted small" style={{ marginLeft: 'auto' }}>
                Estimated from sprints: {fmtDate(`${range.start}T00:00:00`)} –{' '}
                {fmtDate(`${range.end}T00:00:00`)}
              </span>
            )}
          </div>
          <div className="grid2 epic-dates">
            <label className="field">
              <span>Start date</span>
              <DateF
                disabled={!ed}
                value={e.startDate || ''}
                onChange={(v) =>
                  setEpicDates(e, v, e.dueDate && v && e.dueDate < v ? v : e.dueDate || '')
                }
              />
            </label>
            <label className="field">
              <span>Due date</span>
              <DateF
                disabled={!ed}
                value={e.dueDate || ''}
                onChange={(v) =>
                  setEpicDates(e, e.startDate && v && e.startDate > v ? v : e.startDate || '', v)
                }
              />
            </label>
          </div>
          <p className="muted small" style={{ margin: '6px 0 0' }}>
            Shown as a bar on the <a href={`/p/${P().id}/timeline`}>Timeline</a>.
          </p>
        </div>
        <div className="sec">
          <div className="sec-title">
            <h3>Colour</h3>
          </div>
          <div className="row">
            {COLORS.map((c) => (
              <button
                key={c}
                className="icon-btn"
                disabled={!ed}
                aria-label={`Colour ${c}`}
                onClick={() =>
                  mutate(() => {
                    e.color = c;
                  })
                }
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 4,
                  background: c,
                  boxShadow:
                    c === e.color ? '0 0 0 2px var(--bg), 0 0 0 4px var(--border-focus)' : 'none',
                }}
              />
            ))}
          </div>
        </div>
        <div className="sec">
          <div className="sec-title">
            <h3>Progress</h3>
            <span className="muted small" style={{ marginLeft: 'auto' }}>
              {pr.done} of {pr.total} done · {spSum(pr.ts)} story points
            </span>
          </div>
          <ProgBar {...pr} />
        </div>
        <div className="sec">
          <div className="sec-title">
            <h3>Child issues</h3>
            <span className="count">{pr.total}</span>
          </div>
          {pr.total ? (
            <div className="rows">
              {pr.ts.map((t: Any) => (
                <div key={t.id} className="irow" onClick={() => openDrawer('issue', t.id)}>
                  <TypeIcon type={t.type} />
                  <span className="key">{t.key}</span>
                  <span className="sum">{t.title}</span>
                  <span className="right">
                    <Avatar name={t.assignee} />
                    <StatusLoz s={t.status} />
                    <PriorityIcon p={t.priority} />
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted small">No issues in this epic yet.</p>
          )}
        </div>
      </div>
    </>
  );
}
