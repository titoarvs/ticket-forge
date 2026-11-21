'use client';
import {
  P,
  type Any,
  can,
  toast,
  emit,
  mutate,
  openModal,
  setField,
  uid,
  CATEGORIES,
  wCls,
} from '../core';
import { Confirm, SetCard, Ico, I } from '../ui';
import { SF, MenuItem, TF, CB } from '../fields';
import { stepByStep, FlowDiagram } from './FlowDiagram';
import { FlowGraph } from './FlowGraph';
import { CommitName, StatusColorPicker } from './StatusColorPicker';

export function WorkflowSettings() {
  const p = P();
  const wf: Any[] = p.workflow;
  const ed = can('project.settings');
  const free = p.flowMode !== 'custom';
  const counts = (name: string) => p.tickets.filter((t: Any) => t.status === name).length;

  const renameStatus = (i: number, name: string) => {
    if (
      !name ||
      wf.some((x: Any, j: number) => j !== i && x.name.toLowerCase() === name.toLowerCase())
    ) {
      toast('Status names must be unique and not empty.', 'err');
      emit();
      return;
    }
    const w = wf[i];
    mutate((pp) => {
      pp.tickets.forEach((t: Any) => {
        if (t.status === w.name) t.status = name;
      });
      w.name = name;
    });
  };
  const delStatus = (i: number) => {
    const w = wf[i];
    const rest = wf.filter((x: Any) => x !== w);
    const to = rest.find((x: Any) => x.category === w.category) || rest[0];
    const n = counts(w.name);
    openModal(
      <Confirm
        title={`Delete status “${w.name}”?`}
        label="Delete status"
        text={n ? `${n} issues move to “${to.name}”.` : 'No issues use this status.'}
        onYes={() =>
          mutate((pp) => {
            pp.tickets.forEach((x: Any) => {
              if (x.status === w.name) setField(x, 'status', to.name);
            });
            pp.workflow = rest;
            rest.forEach((x: Any) => {
              if (x.next) x.next = x.next.filter((id: string) => id !== w.id);
            });
          })
        }
      />,
    );
  };
  const addStatus = () =>
    mutate((pp) => {
      let n = 'New status',
        k = 1;
      while (pp.workflow.some((w: Any) => w.name === n)) n = `New status ${++k}`;
      const at = Math.max(0, pp.workflow.length - 1);
      const ns: Any = { id: uid(), name: n, category: 'inprogress' };
      if (pp.flowMode === 'custom') {
        // fit it between its neighbours
        const prev = pp.workflow[at - 1],
          next = pp.workflow[at];
        ns.next = [prev?.id, next?.id].filter(Boolean);
        if (prev) prev.next = [...new Set([...(prev.next || []), ns.id])];
        if (next) next.next = [...new Set([...(next.next || []), ns.id])];
      }
      pp.workflow.splice(at, 0, ns);
    });
  const setMode = (mode: string) =>
    mutate((pp) => {
      pp.flowMode = mode;
      if (mode === 'custom' && pp.workflow.every((w: Any) => !w.next)) stepByStep(pp.workflow);
    });
  const toggle = (from: Any, to: Any) =>
    mutate(() => {
      const has = (from.next || []).includes(to.id);
      from.next = has
        ? from.next.filter((id: string) => id !== to.id)
        : [...(from.next || []), to.id];
    });
  const stuck = free
    ? []
    : wf.filter((w) => !(w.next || []).length && !wf.some((x) => x.fromAny && x.id !== w.id));

  return (
    <>
      <FlowGraph />
      <SetCard
        id="statuses"
        title="Statuses"
        desc="The steps issues move through, left to right on the board. Each status is one board column."
        right={<span className="muted small">{wf.length} statuses</span>}
      >
        <div className="set-legend small">
          {CATEGORIES.map(([v, l]) => (
            <span key={v}>
              <span className={`dot-cat s-${v}`} />
              <b>{l}</b>{' '}
              {v === 'todo'
                ? 'not started'
                : v === 'inprogress'
                  ? 'being worked on'
                  : 'counts as finished in progress, sprints and reports'}
            </span>
          ))}
        </div>
        <div className="tbl-scroll">
          <table className="tbl set-tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Color</th>
                <th>Category</th>
                <th className="num">Column limit</th>
                <th className="num">Issues</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {wf.map((w: Any, i: number) => (
                <tr key={w.id}>
                  <td>
                    <CommitName
                      disabled={!ed}
                      value={w.name}
                      onCommit={(v) => renameStatus(i, v)}
                    />
                  </td>
                  <td>
                    <StatusColorPicker w={w} disabled={!ed} />
                  </td>
                  <td>
                    <SF
                      disabled={!ed}
                      aria-label="Category"
                      value={w.category}
                      onChange={(e) =>
                        mutate(() => {
                          w.category = e.target.value;
                        })
                      }
                    >
                      {CATEGORIES.map(([v, l]) => (
                        <MenuItem key={v} value={v}>
                          {l}
                        </MenuItem>
                      ))}
                    </SF>
                  </td>
                  <td className="num" style={{ width: 120 }}>
                    <TF
                      disabled={!ed}
                      type="number"
                      min={0}
                      aria-label={`Column limit for ${w.name}`}
                      placeholder="None"
                      value={w.wip ?? ''}
                      onChange={(e) =>
                        mutate(
                          () => {
                            const v =
                              e.target.value === ''
                                ? null
                                : Math.max(0, Math.round(Number(e.target.value)));
                            if (v) w.wip = v;
                            else delete w.wip;
                          },
                          { tag: `wip${w.id}` },
                        )
                      }
                    />
                  </td>
                  <td className="num">{counts(w.name)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {ed && (
                      <>
                        <button
                          className="icon-btn"
                          disabled={i === 0}
                          title="Move left on the board"
                          aria-label="Move up"
                          onClick={() =>
                            mutate((pp) => {
                              const l = pp.workflow;
                              [l[i], l[i - 1]] = [l[i - 1], l[i]];
                            })
                          }
                        >
                          <Ico svg={I.up} />
                        </button>
                        <button
                          className="icon-btn"
                          disabled={i === wf.length - 1}
                          title="Move right on the board"
                          aria-label="Move down"
                          onClick={() =>
                            mutate((pp) => {
                              const l = pp.workflow;
                              [l[i], l[i + 1]] = [l[i + 1], l[i]];
                            })
                          }
                        >
                          <Ico svg={I.down} />
                        </button>
                        <button
                          className="icon-btn"
                          disabled={wf.length < 2}
                          title="Delete status"
                          aria-label="Delete status"
                          onClick={() => delStatus(i)}
                        >
                          <Ico svg={I.trash} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {ed && (
          <button className="inline-create" style={{ width: 'auto' }} onClick={addStatus}>
            <Ico svg={I.plus} />
            Add status
          </button>
        )}
        <p className="muted small set-note">
          Color: how the status looks on issues, the backlog and the board. Default uses its
          category’s color. Column limit: the board column turns red when it holds more issues than
          this. Leave empty for no limit.
        </p>
      </SetCard>

      <SetCard
        id="transitions"
        title="Transitions"
        desc={
          free
            ? 'Issues can move from any status to any other. Switch to custom transitions to control the order, like a Jira workflow.'
            : 'Only the moves ticked below are allowed. The issue panel offers just those statuses, and the board only accepts those drops.'
        }
        right={
          <div className="seg" role="radiogroup" aria-label="Transitions">
            <button
              role="radio"
              aria-checked={free}
              className={free ? 'on' : ''}
              disabled={!ed}
              onClick={() => setMode('free')}
            >
              Any to any
            </button>
            <button
              role="radio"
              aria-checked={!free}
              className={!free ? 'on' : ''}
              disabled={!ed}
              onClick={() => setMode('custom')}
            >
              Custom
            </button>
          </div>
        }
      >
        <FlowDiagram wf={wf} free={free} />
        {!free && (
          <>
            {ed && (
              <div className="row" style={{ gap: 6, margin: '10px 0' }}>
                <span className="muted small">Start from:</span>
                <button className="btn sm" onClick={() => mutate((pp) => stepByStep(pp.workflow))}>
                  Step by step
                </button>
                <button
                  className="btn sm"
                  onClick={() =>
                    mutate((pp) =>
                      pp.workflow.forEach((w: Any) => {
                        w.next = pp.workflow
                          .filter((x: Any) => x.id !== w.id)
                          .map((x: Any) => x.id);
                        w.fromAny = false;
                      }),
                    )
                  }
                >
                  Allow every move
                </button>
                <button
                  className="btn sm subtle"
                  onClick={() =>
                    mutate((pp) =>
                      pp.workflow.forEach((w: Any) => {
                        w.next = [];
                        w.fromAny = false;
                      }),
                    )
                  }
                >
                  Clear all
                </button>
              </div>
            )}
            <div className="wf-matrix-wrap">
              <table className="tbl wf-matrix">
                <thead>
                  <tr>
                    <th className="wf-corner">
                      <span>From ↓ · To →</span>
                    </th>
                    {wf.map((to) => (
                      <th key={to.id} className="num">
                        <span className={`dot-cat ${wCls(to)}`} />
                        {to.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="wf-any-row">
                    <th scope="row">
                      Any status <span className="muted small">(always allowed)</span>
                    </th>
                    {wf.map((to) => (
                      <td key={to.id} className="num">
                        <CB
                          label=""
                          checked={Boolean(to.fromAny)}
                          disabled={!ed}
                          aria-label={`Any status can move to ${to.name}`}
                          onChange={() =>
                            mutate(() => {
                              to.fromAny = !to.fromAny;
                            })
                          }
                        />
                      </td>
                    ))}
                  </tr>
                  {wf.map((from) => (
                    <tr key={from.id}>
                      <th scope="row">
                        <span className={`dot-cat ${wCls(from)}`} />
                        {from.name}
                      </th>
                      {wf.map((to) =>
                        from.id === to.id ? (
                          <td key={to.id} className="num muted">
                            –
                          </td>
                        ) : (
                          <td key={to.id} className={`num ${to.fromAny ? 'wf-implied' : ''}`}>
                            <CB
                              label=""
                              checked={to.fromAny || (from.next || []).includes(to.id)}
                              disabled={!ed || to.fromAny}
                              aria-label={`${from.name} can move to ${to.name}`}
                              onChange={() => toggle(from, to)}
                            />
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {stuck.length > 0 && (
              <p className="small wf-warn">
                <Ico svg={I.warn} /> {stuck.map((w) => `“${w.name}”`).join(', ')}{' '}
                {stuck.length === 1 ? 'has' : 'have'} no way out: issues there can’t move to any
                other status.
              </p>
            )}
          </>
        )}
      </SetCard>
    </>
  );
}
