'use client';
import Link from 'next/link';
import {
  P,
  can,
  S,
  setMenu,
  openModal,
  feat,
  type Any,
  isSub,
  fmtDate,
  spSum,
  noEpic,
  EMPTY_FILTER,
} from '../core';
import { Menu, Ico, I, TypeIcon, Swatch, EmptyState } from '../ui';
import { RegroupModal, addEpic, openDrawer } from '../actions';
import { openSplitIssues, isBig } from '../Split';
import { FeatureModal } from '../FeatureModal';
import { epicRange } from '../Timeline';
import { DraftBadge } from '../EpicDrafts';
import { EpicDocCell, MissingDocsMenu, DOC_COLUMNS } from '../EpicDocs';
import { Header, epicProgress, ProgBar } from './row-dnd';

// ---------------------------------------------------------------- epics
/** Every AI action on the Epics page in one menu. */
function EpicsAiMenu() {
  const p = P();
  if (!can('ai.use')) return null;
  const plan = can('issue.create'),
    manage = can('epic.manage');
  if (!plan && !manage) return null;
  return (
    <Menu
      id="epics-ai"
      button={
        <button
          className="btn ai"
          aria-haspopup="menu"
          aria-expanded={S.menu === 'epics-ai'}
          onClick={() => setMenu('epics-ai')}
        >
          <Ico svg={I.sparkle} />
          AI actions
          <Ico svg={I.chevron} />
        </button>
      }
    >
      {plan && (
        <>
          <div className="mh">Plan</div>
          <button onClick={() => openModal(<FeatureModal />)}>
            <Ico svg={I.plus} />
            Add feature<small>New epics and issues</small>
          </button>
        </>
      )}
      {manage && (
        <>
          <button onClick={() => openModal(<RegroupModal />)}>
            <Ico svg={I.sparkle} />
            Re-organize epics<small>Regroup issues</small>
          </button>
          {plan && feat('split') && (
            <button onClick={() => openSplitIssues()}>
              <Ico svg={I.subtask} />
              Split issues
              <small>{p.tickets.filter((t: Any) => !isSub(t) && isBig(t)).length} big</small>
            </button>
          )}
          {feat('docs') && <MissingDocsMenu />}
        </>
      )}
    </Menu>
  );
}
export function Epics() {
  const p = P();
  return (
    <>
      <Header
        title="Epics"
        right={
          <>
            <EpicsAiMenu />
            {can('epic.manage') && (
              <button className="btn primary" onClick={addEpic}>
                <Ico svg={I.plus} />
                Create epic
              </button>
            )}
            {feat('timeline') && (
              <Link className="btn" href={`/p/${p.id}/timeline`}>
                <Ico svg={I.calendar} />
                Timeline
              </Link>
            )}
          </>
        }
      />
      {p.epics.length ? (
        <>
          <table className={`tbl ep-tbl ${feat('docs') ? '' : 'no-docs'}`}>
            <thead>
              <tr>
                <th>Epic</th>
                <th>Dates</th>
                {feat('docs') && DOC_COLUMNS.map(([k, label]) => <th key={k}>{label}</th>)}
                <th>Progress</th>
                <th className="num ep-done">Done</th>
                <th className="num">Issues</th>
                <th className="num">Story points</th>
                <th className="num">Test cases</th>
              </tr>
            </thead>
            <tbody>
              {p.epics.map((e: Any) => {
                const pr = epicProgress(e);
                return (
                  <tr key={e.id} className="click" onClick={() => openDrawer('epic', e.id)}>
                    <td className="ep-main">
                      <span className="row" style={{ flexWrap: 'nowrap' }}>
                        <TypeIcon type="Epic" />
                        <span className="key">{e.key}</span>
                        <Swatch color={e.color} />
                        <b style={{ fontWeight: 500 }}>{e.title}</b>
                        {e.draft && <DraftBadge />}
                      </span>
                      {e.description && (
                        <div
                          className="muted small ep-desc"
                          style={{
                            margin: '2px 0 0 24px',
                            maxWidth: 560,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {e.description}
                        </div>
                      )}
                    </td>
                    <td className="small" style={{ whiteSpace: 'nowrap' }} data-label="Dates">
                      {(() => {
                        const r = epicRange(e);
                        return r ? (
                          <span
                            className={r.derived ? 'muted' : ''}
                            title={r.derived ? 'Estimated from its issues’ sprints' : undefined}
                          >
                            {fmtDate(`${r.start}T00:00:00`)} – {fmtDate(`${r.end}T00:00:00`)}
                          </span>
                        ) : (
                          <span className="muted">–</span>
                        );
                      })()}
                    </td>
                    {feat('docs') &&
                      DOC_COLUMNS.map(([k, label]) => (
                        <EpicDocCell key={k} k={k} e={e} label={label} />
                      ))}
                    <td style={{ width: 200 }} data-label="Progress">
                      <ProgBar {...pr} />
                    </td>
                    <td className="num ep-done" data-label="Done">
                      {pr.total ? Math.round((pr.done / pr.total) * 100) : 0}%
                    </td>
                    <td className="num" data-label="Issues">
                      {pr.total}
                    </td>
                    <td className="num" data-label="Story points">
                      {spSum(pr.ts)}
                    </td>
                    <td className="num" data-label="Test cases">
                      {pr.ts.reduce((s: number, t: Any) => s + t.testCases.length, 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {noEpic().length > 0 && (
            <p className="muted small" style={{ marginTop: 12 }}>
              {noEpic().length} issues have no epic.{' '}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  S.filter = { ...EMPTY_FILTER(), epic: 'none' };
                  S.groupBy = 'epic';
                  S.nav(`/p/${p.id}/backlog`);
                }}
              >
                View them in the backlog
              </a>
            </p>
          )}
        </>
      ) : (
        <EmptyState
          icon={I.epic}
          tone="epic"
          title="No epics yet"
          actions={
            can('epic.manage') && (
              <button className="btn primary" onClick={addEpic}>
                <Ico svg={I.plus} />
                Create epic
              </button>
            )
          }
        >
          <p>
            Epics group related issues into larger pieces of work, so you can track progress feature
            by feature.
          </p>
        </EmptyState>
      )}
    </>
  );
}
