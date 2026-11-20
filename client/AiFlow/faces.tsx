'use client';
// What each node shows on the canvas.
import type { Any } from '../core';
import { Ico, I, Spinner } from '../ui';
import type { FNode } from './model';
import { TIER, GROUP_COLOR, hue } from './model';
import { tierCount, configCount, nodeState, engineName, aiName } from './graph';
import type { Flow } from './flow';

const plural = (n: number) => (n === 1 ? '' : 's');
const colorVar = (c: string) => ({ ['--c' as string]: c }) as React.CSSProperties;

function GroupFace({ n, f }: { n: FNode; f: Flow }) {
  const rows = n.rows || [];
  return (
    <>
      <div className="fn-h" style={colorVar(GROUP_COLOR[n.data.group] || '#7c8aa0')}>
        <i aria-hidden />
        <b>{n.data.group}</b>
        <span>{rows.length} tasks</span>
      </div>
      <div className="fn-rows">
        {rows.map((t) => (
          <TaskRow key={t.id} n={n} t={t} f={f} />
        ))}
      </div>
    </>
  );
}

/** One task in a group, with what it runs on and the dot to drag from. */
function TaskRow({ n, t, f }: { n: FNode; t: Any; f: Flow }) {
  const target = f.routing.runsOn(t);
  const isCfg = /^cfg:/.test(target);
  const cf = isCfg ? f.g.configs.find((x) => `cfg:${x.id}` === target) : null;
  const col = isCfg ? '#8b5cf6' : TIER[target]?.color;
  const on = f.sel?.type === 'edge' && f.sel.id === `task:${t.id}`;
  return (
    <div className={`fn-row ${on ? 'on' : ''}`} title={`${t.label}: ${t.desc}`}>
      <span className="fn-row-l">{t.label}</span>
      <em style={colorVar(col)}>{isCfg ? cf?.name || 'Config' : TIER[target]?.label}</em>
      <span
        className="fn-port out"
        data-port="out"
        data-node={n.id}
        data-row={t.id}
        style={colorVar(col)}
        title={`Drag to a tier to choose what “${t.label}” runs on`}
      />
    </div>
  );
}

function TierFace({ n, f }: { n: FNode; f: Flow }) {
  const k = n.data.tier;
  const m = TIER[k];
  const count = tierCount(f.g, f.routing.r, k);
  return (
    <>
      <span className="fn-port in" data-port="in" />
      <div
        className="fn-tier-h"
        style={{
          background: `linear-gradient(135deg, ${m.color}, color-mix(in srgb, ${m.color} 55%, #000))`,
        }}
      >
        <b>{m.label}</b>
        <span>{m.hint}</span>
      </div>
      <div className="fn-tier-b">
        <b>{count}</b> task{plural(count)} run here
        <small>{f.routing.on ? 'on the first AI that’s available' : 'Routing is off'}</small>
      </div>
      <span className="fn-port out" data-port="none" />
    </>
  );
}

function ConfigFace({ n, f }: { n: FNode; f: Flow }) {
  const cf = n.data;
  const count = configCount(f.g, f.routing.r, cf.id);
  return (
    <>
      <span className="fn-port in" data-port="in" />
      <div className="fn-cfg">
        <span className="fn-cfg-i" aria-hidden>
          ⚙
        </span>
        <div>
          <b>{cf.name}</b>
          <small>
            {engineName(f.g, cf, 'API')}
            {cf.model ? ` · ${cf.model}` : ''}
          </small>
        </div>
      </div>
      <div className="fn-foot">
        <small>
          {count} task{plural(count)} routed here
        </small>
      </div>
      <span className="fn-port out" data-port="none" />
    </>
  );
}

function RouterFace({ f }: { f: Flow }) {
  const active = f.g.apis.find((x) => x.active);
  const on = f.routing.on;
  return (
    <>
      <span className="fn-port in" data-port="in" />
      <div className="fn-gw">
        <span className={`fn-gw-i ${on ? 'live' : ''}`} aria-hidden>
          ⇢
        </span>
        <b>Router</b>
        <small>{on ? 'Picks the first available AI' : 'Routing off'}</small>
        {(active || f.g.localMode) && (
          <small className="fn-now">
            Now: <b>{f.g.localMode && !f.c.switched ? 'Claude account' : active?.label || '—'}</b>
          </small>
        )}
      </div>
      <span className="fn-port out" data-port="none" />
    </>
  );
}

/** The test button's icon and text: idle, running, passed (with the time) or failed. */
function TestResult({ test }: { test: Any }) {
  if (test?.running)
    return (
      <>
        <Spinner />
        Testing
      </>
    );
  if (test?.ok === true)
    return (
      <>
        <span className="ok">✓</span>
        {`${(test.ms / 1000).toFixed(1)}s`}
      </>
    );
  if (test?.ok === false)
    return (
      <>
        <span className="bad">✕</span>
        Failed
      </>
    );
  return (
    <>
      <Ico svg={I.play} />
      Test
    </>
  );
}

const modelOf = (f: Flow, n: FNode) => {
  if (n.kind !== 'local') return n.data.model || '';
  if (n.data.which === 'claude') return 'Claude Code on this computer';
  return `Copilot${f.c.copilotModel ? ` · ${f.c.copilotModel}` : ''}`;
};

function ProviderFace({ n, f }: { n: FNode; f: Flow }) {
  const x = n.data;
  const isLocal = n.kind === 'local';
  const label = aiName(n);
  const model = modelOf(f, n);
  const st = nodeState(f.c, n);
  const idx = f.g.chain.indexOf(n.id);
  const { busy, tests, toggleProvider, testNode } = f.providers;
  const initial = isLocal
    ? x.which === 'claude'
      ? 'C'
      : 'G'
    : String(label).slice(0, 1).toUpperCase();
  return (
    <>
      <span className={`fn-port ${idx > 0 ? 'top' : 'in'}`} data-port="in" />
      <div className="fn-p">
        <span
          className="fn-av"
          style={{ background: `hsl(${hue(isLocal ? x.which : x.id)} 55% 42%)` }}
          aria-hidden
        >
          {initial}
        </span>
        <div className="fn-pt">
          <b>{label}</b>
          {model && <code>{model}</code>}
        </div>
        <span className={`fn-st s-${st.k}`} title={st.title}>
          {st.label}
        </span>
      </div>
      <div className="fn-pf" data-nodrag>
        <span className="fn-n" title="Priority: the first available AI answers">
          #{idx + 1}
        </span>
        {!isLocal && (
          <label className="fn-sw" title={x.enabled ? 'Turn off' : 'Turn on'}>
            <input
              type="checkbox"
              checked={x.enabled}
              disabled={x.source !== 'panel' || busy === `on:${x.entryId}`}
              onChange={(e) => toggleProvider(x, e.target.checked)}
            />
            <i />
          </label>
        )}
        <button
          type="button"
          className="fn-btn"
          disabled={!!busy || (!isLocal && !x.configured)}
          onClick={() => testNode(n.id)}
          title="Test the connection"
        >
          <TestResult test={tests[n.id]} />
        </button>
        <button
          type="button"
          className="fn-btn ghost"
          onClick={() => f.setSel({ type: 'node', id: n.id })}
          aria-label={`${label} details`}
        >
          Details
        </button>
      </div>
      <span
        className="fn-port out bottom"
        data-port="out"
        data-node={n.id}
        title="Drag to another provider to try it next, after this one"
      />
      <span className="fn-port out right" data-port="none" />
    </>
  );
}

export function NodeFace({ n, f }: { n: FNode; f: Flow }) {
  if (n.kind === 'group') return <GroupFace n={n} f={f} />;
  if (n.kind === 'tier') return <TierFace n={n} f={f} />;
  if (n.kind === 'config') return <ConfigFace n={n} f={f} />;
  if (n.kind === 'gateway') return <RouterFace f={f} />;
  if (n.kind === 'add')
    return (
      <button type="button" className="fn-add" onClick={f.actions.add} data-nodrag>
        <Ico svg={I.plus} />
        Add provider
      </button>
    );
  return <ProviderFace n={n} f={f} />;
}
