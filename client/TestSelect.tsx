'use client';
// Test automation → Smart selection: the Test Selection Agent picks the tests worth running for the current change
// (code changes since the last run, recently changed issues, recent failures), with a reason for each. You review the
// list, untick any, then run it.
import { useState } from 'react';
import { P, api, aiBody, toast, closeModal, mutate, type Any } from './core';
import { Ico, I, Modal, Spinner } from './ui';
import { TF, TA, CB } from './fields';
import { runTests } from './actions';

const RISK: Record<string, string> = { high: 't-fail', medium: 't-blocked', low: '' };

export function SmartSelectModal() {
  const [budget, setBudget] = useState(25);
  const [goal, setGoal] = useState('');
  const [useCode, setUseCode] = useState(true);
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Any>(null);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const local = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const choose = async () => {
    setBusy(true);
    try {
      const r = await api(`/api/projects/${P().id}/testselect`, { method: 'POST', body: aiBody({ budget, goal, useCode, includeManual: manual }) });
      setRes(r); setPick(Object.fromEntries(r.selected.map((s: Any) => [s.tcId, true])));
    } catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const chosen = (res?.selected || []).filter((s: Any) => pick[s.tcId]);
  const run = () => {
    const list = chosen.map((s: Any) => { const t = P().tickets.find((x: Any) => x.id === s.ticketId); return { t, tc: t?.testCases.find((x: Any) => x.id === s.tcId) }; }).filter((x: Any) => x.t && x.tc);
    if (res.head) mutate((pp: Any) => { pp.automation.lastRunSha = res.head; });
    closeModal(); runTests(list);
  };
  return (
    <Modal title="🎯 Smart selection" wide persistent actions={res
      ? [{ label: 'Back', onClick: () => setRes(null) }, { label: chosen.length ? `Run ${chosen.length} selected` : 'Nothing selected', kind: 'primary', disabled: !chosen.length, onClick: run }]
      : [{ label: 'Cancel' }, { label: busy ? 'Choosing…' : 'Choose tests', kind: 'ai', disabled: busy, onClick: choose }]}>
      {!res ? <>
        <p className="muted small" style={{ marginTop: 0 }}>The Test Selection Agent ranks the automated tests by risk: the pages and files that changed in the code since the last run, issues changed this week, and tests that failed, were flaky or haven’t run for a while. It picks the ones worth running within your budget, so a run takes minutes instead of the whole suite.</p>
        <div className="grid2">
          <label className="field"><span>At most this many tests</span><TF type="number" value={budget} slotProps={{ htmlInput: { min: 1, max: 200 } }} onChange={(e) => setBudget(Number(e.target.value) || 1)} /></label>
          <div className="field"><span>Signals</span>
            <CB label={local ? 'Read code changes from the local repository' : 'Code changes (only on your own computer)'} checked={useCode && local} disabled={!local} onChange={(e: Any) => setUseCode(e.target.checked)} />
            <CB label="Include tests without a script (written before running)" checked={manual} onChange={(e: Any) => setManual(e.target.checked)} /></div>
        </div>
        <label className="field"><span>Goal of this run (optional)</span><TA rows={2} value={goal} placeholder="e.g. Release check for the payroll computation changes" onChange={(e) => setGoal(e.target.value)} /></label>
        {busy && <p className="muted small"><Spinner /> Reading the changes and choosing…</p>}
      </> : <>
        <div className="sync-sum"><span><b>{res.selected.length}</b> of {res.considered} tests chosen</span><span>{res.changeNote}</span></div>
        {res.summary && <p className="small" style={{ margin: '8px 0' }}>{res.summary}</p>}
        <div className="ts-list">{res.selected.map((s: Any) => (
          <label key={s.tcId} className={`ts-row ${pick[s.tcId] ? '' : 'off'}`}>
            <CB checked={Boolean(pick[s.tcId])} onChange={() => setPick({ ...pick, [s.tcId]: !pick[s.tcId] })} aria-label={`Run ${s.key}`} />
            <span className={`loz ${RISK[s.risk]}`}>{s.risk}</span>
            <span className="ts-main"><span><span className="key">{s.key}</span> {s.title}</span><span className="muted small">{s.reason}</span></span>
          </label>))}</div>
        {res.gaps?.length > 0 && <div className="warn-banner" style={{ marginTop: 10 }}><Ico svg={I.warn} /><span><b>Not covered by any test:</b> {res.gaps.join(' · ')}</span></div>}
      </>}
    </Modal>
  );
}
