'use client';
// The details panel for the selected wire or node (providers: provider-inspector.tsx).
import type { Any } from '../core';
import { SF, MenuItem } from '../fields';
import type { FNode } from './model';
import { TIER } from './model';
import { type Edge, tierCount, engineName, aiName } from './graph';
import type { Flow } from './flow';
import { TierModelField, ModelSaveBar } from './model-fields';
import { ProviderInspector } from './provider-inspector';

/** Choose a tier or a configuration for a task. */
function TaskTarget({ f, t, long }: { f: Flow; t: Any; long?: boolean }) {
  return (
    <SF
      value={f.routing.runsOn(t)}
      onChange={(e) => f.routing.setTaskTier(t.id, String(e.target.value))}
    >
      {f.g.tiers.map((k) => (
        <MenuItem key={k} value={k}>
          {long ? `${TIER[k].label} · ${TIER[k].hint}` : TIER[k].label}
        </MenuItem>
      ))}
      {f.g.configs.map((x) => (
        <MenuItem key={x.id} value={`cfg:${x.id}`}>
          {long ? 'Configuration' : 'Config'}: {x.name}
        </MenuItem>
      ))}
    </SF>
  );
}

function RouteInspector({ f, edge }: { f: Flow; edge: Edge }) {
  const t = f.g.tasks.find((x) => x.id === edge.task);
  return (
    <>
      <h4>Route: {t?.label}</h4>
      <p className="muted small">{t?.desc}</p>
      <label className="field">
        <span>Runs on</span>
        <TaskTarget f={f} t={t} long />
      </label>
      <button type="button" className="btn sm" onClick={() => f.routing.resetTask(t.id)}>
        Disconnect: back to the default ({TIER[t.tier].label})
      </button>
    </>
  );
}

function EdgeInspector({ edge }: { edge: Edge }) {
  const fallback = edge.kind === 'fallback';
  return (
    <>
      <h4>{fallback ? 'Fallback' : 'Connection'}</h4>
      <p className="muted small">
        {fallback
          ? 'If the provider above is limited, out of credits or failing, TicketForge tries this one, and tries the first again later. Drag a provider’s bottom dot onto another to change the order.'
          : 'Every tier goes to the router, which picks the first AI that’s available.'}
      </p>
    </>
  );
}

function GroupInspector({ f, n }: { f: Flow; n: FNode }) {
  return (
    <>
      <h4>{n.data.group}</h4>
      <p className="muted small">
        Choose what each task runs on. You can also drag from a task’s dot to a tier.
      </p>
      <div className="fi-list">
        {(n.rows || []).map((t) => (
          <label key={t.id} className="fi-task">
            <span>
              <b>{t.label}</b>
              <small>{t.desc}</small>
            </span>
            <TaskTarget f={f} t={t} />
          </label>
        ))}
      </div>
    </>
  );
}

function TierInspector({ f, n }: { f: Flow; n: FNode }) {
  const k = n.data.tier;
  const count = tierCount(f.g, f.routing.r, k);
  return (
    <>
      <h4>
        <i className="fi-dot" style={{ background: TIER[k].color }} />
        {TIER[k].label} tier
      </h4>
      <p className="muted small">
        {TIER[k].hint}. {count} task{count === 1 ? '' : 's'} run here.
      </p>
      <div className="fi-chips">
        {f.g.tasks
          .filter((t) => f.routing.runsOn(t) === k)
          .map((t) => (
            <span key={t.id}>{t.label}</span>
          ))}
      </div>
      <h5>Model on each AI</h5>
      {f.g.chain.map((id) => (
        <label key={id} className="field">
          <span>{aiName(f.g.byId[id])}</span>
          <TierModelField f={f} tier={k} node={f.g.byId[id]} />
        </label>
      ))}
      {!f.g.chain.length && <p className="muted small">Add a provider first.</p>}
      <ModelSaveBar f={f} />
    </>
  );
}

function ConfigInspector({ f, n }: { f: Flow; n: FNode }) {
  const cf = n.data;
  return (
    <>
      <h4>{cf.name}</h4>
      <p className="muted small">
        A named AI setup. Tasks you wire here run on it, and people can pick it on any AI button.
      </p>
      <table className="fi-kv">
        <tbody>
          <tr>
            <td>Runs on</td>
            <td>{engineName(f.g, cf, 'An AI API')}</td>
          </tr>
          <tr>
            <td>Model</td>
            <td>{cf.model || 'Default'}</td>
          </tr>
          <tr>
            <td>Reasoning</td>
            <td>{cf.reasoning || 'Default'}</td>
          </tr>
        </tbody>
      </table>
      <button type="button" className="btn sm" onClick={() => f.actions.goto('configs')}>
        Edit in Configurations
      </button>
    </>
  );
}

function RouterInspector({ f }: { f: Flow }) {
  const { on, saving, setRouting, patch } = f.routing;
  return (
    <>
      <h4>Router</h4>
      <p className="muted small">
        Every request arrives here from its tier and goes to the first AI that’s available. If it’s
        limited or failing, the next one is tried, and the first again later.
      </p>
      <label className="fi-sw">
        <input
          type="checkbox"
          checked={on}
          disabled={saving}
          onChange={(e) => setRouting(e.target.checked)}
        />
        <span>
          <b>Model routing</b>
          <small>Each task uses its tier’s model. Off: every task uses the AI’s own model.</small>
        </span>
      </label>
      {f.g.localMode && (
        <label className="fi-sw">
          <input
            type="checkbox"
            checked={f.c.accountFallback !== false}
            disabled={saving}
            onChange={(e) => patch({ accountFallback: e.target.checked })}
          />
          <span>
            <b>Use the providers when the local AI can’t</b>
            <small>Not installed, not signed in, or limit reached.</small>
          </span>
        </label>
      )}
      {(f.c.apis || []).some((x: Any) => x.cooldown) && (
        <button type="button" className="btn sm" onClick={f.providers.clearCooldowns}>
          Clear all cooldowns
        </button>
      )}
    </>
  );
}

export function Inspector({ f, node, edge }: { f: Flow; node: FNode | null; edge: Edge | null }) {
  if (edge)
    return edge.kind === 'route' ? (
      <RouteInspector f={f} edge={edge} />
    ) : (
      <EdgeInspector edge={edge} />
    );
  if (!node || node.kind === 'add') return null;
  if (node.kind === 'group') return <GroupInspector f={f} n={node} />;
  if (node.kind === 'tier') return <TierInspector f={f} n={node} />;
  if (node.kind === 'config') return <ConfigInspector f={f} n={node} />;
  if (node.kind === 'gateway') return <RouterInspector f={f} />;
  return <ProviderInspector f={f} n={node} />;
}
