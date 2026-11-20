'use client';
import {
  type Any,
  can,
  S,
  mutate,
  logChange,
  emit,
  tcKey,
  tCls,
  TC_STATUS,
  TC_TYPES,
  P,
  ago,
  clone,
  uid,
  logEvent,
} from '../core';
import { Ico, I } from '../ui';
import { runTests } from '../actions';
import { setTcStatus } from '../views';
import { TF, SF, opts, MenuItem, TA } from '../fields';

export function TestCase({ t, tc, i }: { t: Any; tc: Any; i: number }) {
  const edit = can('issue.edit');
  const open = S.openTc.has(tc.id);
  const running = S.autoRun?.running && S.autoRun.current === tc.id;
  const r = tc.lastRun;
  const set = (k: string, v: Any) =>
    mutate(
      () => {
        const old = tc[k];
        tc[k] = v;
        if (k !== 'script') logChange(t, 'testCases', old, v);
      },
      { tag: `tc${tc.id}${k}` },
    );
  const toggle = () => {
    if (open) S.openTc.delete(tc.id);
    else S.openTc.add(tc.id);
    emit();
  };
  return (
    <div className="tc" id={`tc-${tc.id}`}>
      <div
        className={`tc-h ${open ? '' : 'closed'}`}
        onClick={(ev) => {
          if (
            !(ev.target as HTMLElement).closest(
              'input,select,button,.MuiInputBase-root,.MuiMenuItem-root,.MuiBackdrop-root',
            )
          )
            toggle();
        }}
      >
        <Ico svg={I.chevron} />
        <span className="key">{tcKey(t, i)}</span>
        <TF
          aria-label="Test case title"
          disabled={!edit}
          value={tc.title}
          onChange={(ev) => set('title', ev.target.value)}
        />
        {running ? (
          <span className="spinner" style={{ color: 'var(--brand)' }} title="Running" />
        ) : tc.script ? (
          <span className="muted" title="Automated">
            <Ico svg={I.bot} />
          </span>
        ) : null}
        {can('test.run') && (
          <button
            className="icon-btn"
            title="Run automated test"
            disabled={S.autoRun?.running}
            onClick={() => runTests([{ t, tc }])}
          >
            <Ico svg={I.play} />
          </button>
        )}
        <SF
          loz
          className={`loz ${tCls(tc.status)}`}
          aria-label="Result"
          disabled={!can('test.run') && !edit}
          value={tc.status}
          onChange={(ev) => setTcStatus(t, tc, ev.target.value)}
        >
          {opts(TC_STATUS)}
        </SF>
      </div>
      {open && (
        <div className="tc-b">
          <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
            <label className="field">
              <span>Type</span>
              <SF disabled={!edit} value={tc.type} onChange={(ev) => set('type', ev.target.value)}>
                {opts(TC_TYPES.includes(tc.type) ? TC_TYPES : [tc.type, ...TC_TYPES])}
              </SF>
            </label>
            <label className="field">
              <span>Priority</span>
              <SF
                disabled={!edit}
                value={tc.priority}
                onChange={(ev) => set('priority', ev.target.value)}
              >
                {opts(['High', 'Medium', 'Low'])}
              </SF>
            </label>
            <label className="field">
              <span>Covers AC #</span>
              <TF
                disabled={!edit}
                key={(tc.acRef || []).join(',')}
                defaultValue={(tc.acRef || []).join(', ')}
                placeholder="e.g. 1, 3"
                onBlur={(ev) =>
                  set(
                    'acRef',
                    ev.target.value
                      .split(/[,\s]+/)
                      .map((s) => Number(s.replace(/\D/g, '')))
                      .filter((n) => n > 0),
                  )
                }
              />
            </label>
            <label className="field">
              <span>Run as</span>
              <SF
                disabled={!edit}
                value={tc.roleId || ''}
                onChange={(ev) => set('roleId', ev.target.value || null)}
              >
                <MenuItem value="">Not signed in</MenuItem>
                {(P().automation?.app?.roles || [])
                  .filter((r: Any) => r.name)
                  .map((r: Any) => (
                    <MenuItem key={r.id} value={r.id}>
                      {r.name}
                    </MenuItem>
                  ))}
                {tc.roleId &&
                  !(P().automation?.app?.roles || []).some((r: Any) => r.id === tc.roleId) && (
                    <MenuItem value={tc.roleId}>Removed role</MenuItem>
                  )}
              </SF>
            </label>
          </div>
          <label className="field">
            <span>Preconditions</span>
            <TA
              style={{ minHeight: 32 }}
              disabled={!edit}
              value={tc.preconditions}
              onChange={(ev) => set('preconditions', ev.target.value)}
            />
          </label>
          <label className="field">
            <span>Steps — one per line</span>
            <TA
              disabled={!edit}
              key={(tc.steps || []).join('|')}
              defaultValue={(tc.steps || []).join('\n')}
              onBlur={(ev) =>
                set(
                  'steps',
                  ev.target.value
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean),
                )
              }
            />
          </label>
          <label className="field">
            <span>Expected result</span>
            <TA
              style={{ minHeight: 32 }}
              disabled={!edit}
              value={tc.expected}
              onChange={(ev) => set('expected', ev.target.value)}
            />
          </label>
          {r && (
            <div className={`run-box ${tCls(r.status)}`}>
              <div className="row small">
                <span className={`loz ${tCls(r.status)}`}>
                  <Ico svg={I.bot} /> {r.status}
                </span>
                <span className="muted">
                  Automated run {ago(r.at)} · {(r.durationMs / 1000).toFixed(1)}s
                </span>
                {r.screenshot && (
                  <a href={r.screenshot} target="_blank" rel="noopener noreferrer">
                    <Ico svg={I.external} /> Screenshot
                  </a>
                )}
              </div>
              {r.error && <pre className="err-box">{r.error}</pre>}
              {r.logs?.length > 0 && (
                <details>
                  <summary className="small muted">Browser console ({r.logs.length})</summary>
                  <pre className="code small">{r.logs.join('\n')}</pre>
                </details>
              )}
            </div>
          )}
          <details className="script-box">
            <summary className="small">
              <Ico svg={I.bot} /> Automation script{' '}
              {!tc.script && <span className="muted">(written by Claude on first run)</span>}
            </summary>
            <TA
              mono
              spellCheck={false}
              max={420}
              disabled={!can('test.run') && !edit}
              value={tc.script || ''}
              placeholder="// Body of async ({ page, expect, baseURL, app }) => { … }  e.g. await app.loginAs('Admin'); await app.goto('Orders');"
              onChange={(ev) => set('script', ev.target.value)}
            />
            {can('test.run') && can('ai.use') && (
              <div className="row" style={{ marginTop: 6 }}>
                <button
                  className="btn sm"
                  onClick={() => runTests([{ t, tc }], { regenerate: true })}
                >
                  <Ico svg={I.sparkle} />
                  Rewrite with Claude and run
                </button>
              </div>
            )}
          </details>
          {edit && (
            <div className="row" style={{ justifyContent: 'flex-end', margin: '8px 0' }}>
              <button
                className="btn sm subtle"
                onClick={() => {
                  const n = { ...clone(tc), id: uid(), lastRun: null };
                  S.openTc.add(n.id);
                  mutate(() => t.testCases.splice(i + 1, 0, n));
                }}
              >
                <Ico svg={I.copy} />
                Duplicate
              </button>
              <button
                className="btn sm danger-subtle"
                onClick={() =>
                  mutate(() => {
                    const [x] = t.testCases.splice(i, 1);
                    logEvent(t, `removed test case “${x.title}”`);
                  })
                }
              >
                <Ico svg={I.trash} />
                Remove
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
