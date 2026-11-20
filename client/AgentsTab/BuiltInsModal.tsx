'use client';
import { useState } from 'react';
import { type Any, toast } from '../core';
import { agentsAction } from '../api/agents';
import { Ico, I, Modal, Spinner } from '../ui';
import { SF, MenuItem } from '../fields';
import { phaseClass } from '../Agents';

/** On/off switch for an agent, right on its card or row. */
export function Toggle({
  a,
  onChange,
  busy,
}: {
  a: Any;
  onChange: (on: boolean) => void;
  busy: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={a.enabled}
      aria-label={`${a.name}: ${a.enabled ? 'on' : 'off'}`}
      title={a.enabled ? 'On: people can hire it. Click to turn off.' : 'Off. Click to turn on.'}
      className={`ag-switch ${a.enabled ? 'on' : ''}`}
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!a.enabled);
      }}
    >
      <i />
    </button>
  );
}
export const modelOf = (a: Any) =>
  a.runner === 'code' || a.runner === 'panel' ? a.model || a.defaults?.model || '' : '';
/** One agent card: what it does, where it runs, its model, an on/off switch, Details and Hire. */
export function Card({
  a,
  onDetails,
  onHire,
  onToggle,
  busy,
}: {
  a: Any;
  onDetails: () => void;
  onHire?: () => void;
  onToggle: (on: boolean) => void;
  busy: boolean;
}) {
  return (
    <article
      className={`ag-card ${phaseClass(a.phase)} ${a.enabled ? '' : 'off'} ${a.broken ? 'broken' : ''}`}
      onClick={onDetails}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          onDetails();
        }
      }}
      aria-label={`${a.name} details`}
    >
      <header>
        <span className="agent-icon" aria-hidden>
          {a.icon}
        </span>
        <div className="ag-title">
          <h4>{a.name}</h4>
          <span>
            {a.team || a.phase}
            {a.custom ? ' · Custom' : ''}
          </span>
        </div>
        <Toggle a={a} onChange={onToggle} busy={busy} />
      </header>
      <p className="ag-sum">{a.summary}</p>
      <div className="ag-meta">
        <span className="ag-chip">
          <Ico
            svg={
              a.runner === 'code' || a.runner === 'panel'
                ? I.pr
                : a.runner === 'document'
                  ? I.doc
                  : a.runner === 'testing'
                    ? I.test
                    : I.sparkle
            }
          />
          {a.workspaceLabel}
        </span>
        {modelOf(a) && <span className="ag-chip mono">{modelOf(a)}</span>}
        {a.runner === 'code' && (
          <span className="ag-chip">{a.writes ? 'Edits code' : 'Read-only'}</span>
        )}
        {a.broken && <span className="ag-chip bad">Rules need fixing</span>}
      </div>
      <footer onClick={(e) => e.stopPropagation()}>
        <button className="btn sm subtle" onClick={onDetails}>
          Details
        </button>
        {a.runner === 'testing' ? (
          <span className="muted small">
            {a.enabled ? 'Runs in test runs' : 'Off in test runs'}
          </span>
        ) : (
          onHire && (
            <button
              className="btn sm"
              disabled={!a.enabled}
              onClick={onHire}
              title={a.enabled ? `Put ${a.name} to work on an epic` : 'Turn it on first'}
            >
              <Ico svg={I.bot} />
              Hire
            </button>
          )
        )}
      </footer>
    </article>
  );
}
/** Remove (hide) or restore TicketForge's built-in agents. Removed ones stay restorable. */
export function BuiltInsModal({ data: first, onData }: { data: Any; onData: (d: Any) => void }) {
  const [data, setData] = useState<Any>(first);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  const list: Any[] = data.builtIns || [];
  const act = async (action: 'remove' | 'restore', ids: string[]) => {
    if (!ids.length) return;
    setBusy(action);
    try {
      const d = await agentsAction({ action, ids });
      onData(d);
      setData(d);
      setSel(new Set());
      toast(
        `${ids.length} built-in agent${ids.length === 1 ? '' : 's'} ${action === 'remove' ? 'removed' : 'restored'}`,
      );
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const toggle = (id: string) =>
    setSel((x) => {
      const n = new Set(x);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const active = list.filter((b) => !b.removed),
    removed = list.filter((b) => b.removed);
  const kind = (b: Any) =>
    b.runner === 'code'
      ? b.writes
        ? 'Edits code'
        : 'Reviews code'
      : b.runner === 'testing'
        ? 'Test runs'
        : b.runner === 'panel'
          ? 'Review panel'
          : 'Documents';
  return (
    <Modal title="Built-in agents" wide actions={[{ label: 'Close' }]}>
      <p className="muted small" style={{ marginTop: 0 }}>
        TicketForge comes with these agents. Remove the ones you don’t want; your custom agents take
        over their jobs (set which under <b>Default agents</b>). Removed agents can be restored at
        any time. Document features (test cases, agent documents…) keep working from the epic; they
        just leave this catalog.
      </p>
      <div className="bi-bar">
        <button
          className="btn danger-subtle"
          disabled={!!busy || !active.length}
          onClick={() =>
            act(
              'remove',
              active.map((b) => b.id),
            )
          }
        >
          {busy === 'remove' ? <Spinner /> : null}Remove all built-in agents ({active.length})
        </button>
        {removed.length > 0 && (
          <button
            className="btn"
            disabled={!!busy}
            onClick={() =>
              act(
                'restore',
                removed.map((b) => b.id),
              )
            }
          >
            Restore all ({removed.length})
          </button>
        )}
        <span className="spacer" />
        {sel.size > 0 && (
          <>
            <button
              className="btn sm danger-subtle"
              disabled={!!busy}
              onClick={() =>
                act(
                  'remove',
                  [...sel].filter((id) => active.some((b) => b.id === id)),
                )
              }
            >
              Remove selected
            </button>
            <button
              className="btn sm"
              disabled={!!busy}
              onClick={() =>
                act(
                  'restore',
                  [...sel].filter((id) => removed.some((b) => b.id === id)),
                )
              }
            >
              Restore selected
            </button>
          </>
        )}
      </div>
      <ul className="bi-list">
        {list.map((b) => (
          <li key={b.id} className={b.removed ? 'removed' : ''}>
            <label>
              <input type="checkbox" checked={sel.has(b.id)} onChange={() => toggle(b.id)} />
              <span className="agent-icon sm" aria-hidden>
                {b.icon}
              </span>
              <b>{b.name}</b>
              <span className="muted small">{kind(b)}</span>
            </label>
            <span className={`bi-state ${b.removed ? 'off' : 'on'}`}>
              {b.removed ? 'Removed' : 'In use'}
            </span>
            <button
              className="btn sm subtle"
              disabled={!!busy}
              onClick={() => act(b.removed ? 'restore' : 'remove', [b.id])}
            >
              {b.removed ? 'Restore' : 'Remove'}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
/** Which agent does each code job: Write code, Frontend, Backend, Review. */
export function DefaultAgents({ data, onData }: { data: Any; onData: (d: Any) => void }) {
  const [busy, setBusy] = useState(false);
  const roles = data.roles || {};
  const options = (writes: boolean) =>
    data.agents.filter(
      (a: Any) => a.runner === 'code' && !a.broken && a.enabled && Boolean(a.writes) === writes,
    );
  const set = async (key: string, id: string) => {
    setBusy(true);
    const next: Any = Object.fromEntries(
      Object.entries(roles).map(([k, r]: Any) => [k, r.chosen || '']),
    );
    next[key] = id;
    try {
      onData(
        await agentsAction({
          action: 'roles',
          roles: Object.fromEntries(Object.entries(next).filter(([, v]) => v)),
        }),
      );
      toast('Default agents saved');
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };
  const nameOf = (id: string) => data.agents.find((a: Any) => a.id === id)?.name || id;
  return (
    <section className="ag-roles">
      <div className="ag-roles-h">
        <b>Default agents</b>
        <span className="muted small">
          Who does each job when nobody picks an agent: Write code with AI, bulk coding, and the
          reviews of a code job.
        </span>
      </div>
      <div className="ag-roles-grid">
        {Object.entries(roles).map(([k, r]: Any) => (
          <label key={k} className="field" style={{ margin: 0 }}>
            <span>{r.label}</span>
            <SF value={r.chosen || ''} disabled={busy} onChange={(e) => set(k, e.target.value)}>
              <MenuItem value="">Automatic{r.agent ? ` (${nameOf(r.agent)})` : ''}</MenuItem>
              {options(r.writes).map((a: Any) => (
                <MenuItem key={a.id} value={a.id}>
                  {a.icon} {a.name}
                  {a.custom ? ' · custom' : ''}
                </MenuItem>
              ))}
            </SF>
            {!r.agent && (
              <small className="bad-text">
                No {r.writes ? 'code' : 'review'} agent: create one
                {r.writes ? ' (kind: Code)' : ' (kind: Review)'}.
              </small>
            )}
          </label>
        ))}
      </div>
    </section>
  );
}
