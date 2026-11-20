'use client';
import { useState } from 'react';
import { ago, type Any, P, tcKey, api, toast, openModal, can, S } from '../core';
import { Modal, Ico, I, TypeIcon, Spinner, EmptyState } from '../ui';
import { openDrawer, runTests, ScriptModal } from '../actions';
import { TF } from '../fields';
import { RunLoz } from './test-rows';

// ---------------------------------------------------------------- source & settings
/** An input that commits on blur (used where every keystroke would cascade, e.g. renames). */
export function CommitInput({
  value,
  onCommit,
  ...rest
}: { value: string; onCommit: (v: string) => void } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <TF
      key={value}
      defaultValue={value}
      onBlur={(e) => {
        if (e.target.value.trim() !== value) onCommit(e.target.value.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      {...rest}
    />
  );
}
export const lines = (v: string) =>
  v
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
// ---------------------------------------------------------------- failures (Test automation →
// Failures)
/** A failed test's screenshot, large. */
export function ShotModal({
  url,
  title,
  error,
  at,
}: {
  url: string;
  title: string;
  error?: string;
  at?: string;
}) {
  return (
    <Modal
      title={title}
      wide
      actions={[{ label: 'Close' }]}
      left={
        <a className="btn subtle" href={url} target="_blank" rel="noopener noreferrer">
          <Ico svg={I.external} />
          Open full size
        </a>
      }
    >
      {at && (
        <p className="muted small" style={{ marginTop: 0 }}>
          Failed {ago(at)} · {new Date(at).toLocaleString()}
        </p>
      )}
      <a href={url} target="_blank" rel="noopener noreferrer" className="shot-big">
        <img src={url} alt={`Screenshot: ${title}`} />
      </a>
      {error && (
        <pre className="err-box" style={{ marginTop: 12 }}>
          {error.split('\n').slice(0, 12).join('\n')}
        </pre>
      )}
    </Modal>
  );
}
function FailureCard({ t, tc, i }: { t: Any; tc: Any; i: number }) {
  const p = P();
  const r = tc.lastRun;
  const [hist, setHist] = useState<Any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const title = `${tcKey(t, i)} ${tc.title}`;
  const loadHistory = async () => {
    if (hist) {
      setHist(null);
      return;
    }
    setLoading(true);
    try {
      setHist(
        (await api(`/api/projects/${p.id}/screenshots?tc=${encodeURIComponent(tc.id)}`)).filter(
          (x: Any) => x.url !== r.screenshot,
        ),
      );
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="fail-card">
      {r.screenshot ? (
        <button
          type="button"
          className="shot-thumb"
          onClick={() =>
            openModal(<ShotModal url={r.screenshot} title={title} error={r.error} at={r.at} />)
          }
        >
          <img
            src={r.screenshot}
            alt={`Screenshot of the failed test ${tc.title}`}
            loading="lazy"
          />
        </button>
      ) : (
        <div className="shot-thumb none">
          <Ico svg={I.warn} />
          <span className="small muted">No screenshot</span>
        </div>
      )}
      <div className="fail-body">
        <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          <RunLoz tc={tc} />
          <span className="key">{tcKey(t, i)}</span>
          <span className="muted small" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
            {ago(r.at)}
          </span>
        </div>
        <b className="fail-title" title={tc.title}>
          {tc.title}
        </b>
        <button
          type="button"
          className="link-btn small fail-issue"
          onClick={() => openDrawer('issue', t.id)}
        >
          <TypeIcon type={t.type} /> {t.key} {t.title}
        </button>
        {r.error && <pre className="err-box">{r.error.split('\n').slice(0, 5).join('\n')}</pre>}
        <div className="row" style={{ gap: 6, marginTop: 'auto' }}>
          {can('test.run') && (
            <button
              className="btn sm"
              disabled={S.autoRun?.running}
              onClick={() => runTests([{ t, tc }])}
            >
              <Ico svg={I.play} />
              Run again
            </button>
          )}
          {tc.script && (
            <button
              className="btn sm subtle"
              onClick={() => openModal(<ScriptModal tid={t.id} tcid={tc.id} />)}
            >
              <Ico svg={I.bot} />
              Script
            </button>
          )}
          <button
            className="btn sm subtle"
            style={{ marginLeft: 'auto' }}
            disabled={loading}
            onClick={loadHistory}
          >
            {loading ? <Spinner /> : hist ? 'Hide history' : 'Earlier failures'}
          </button>
        </div>
        {hist &&
          (hist.length ? (
            <div className="shot-strip">
              {hist.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className="shot-thumb xs"
                  title={`Failed ${new Date(h.created_at).toLocaleString()}`}
                  onClick={() =>
                    openModal(
                      <ShotModal url={h.url} title={title} error={h.error} at={h.created_at} />,
                    )
                  }
                >
                  <img
                    src={h.url}
                    alt={`Earlier failure, ${new Date(h.created_at).toLocaleString()}`}
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          ) : (
            <p className="muted small" style={{ margin: '6px 0 0' }}>
              No earlier failures saved.
            </p>
          ))}
      </div>
    </div>
  );
}
export function Failures() {
  const p = P();
  const fails = p.tickets
    .flatMap((t: Any) => t.testCases.map((tc: Any, i: number) => ({ t, tc, i })))
    .filter((x: Any) => x.tc.lastRun && x.tc.lastRun.status !== 'Pass')
    .sort((a: Any, b: Any) => String(b.tc.lastRun.at).localeCompare(String(a.tc.lastRun.at)));
  if (!fails.length) {
    return (
      <EmptyState icon={I.check} tone="success" title="No failing tests">
        <p>Tests that fail show up here with a screenshot of the page at the moment they failed.</p>
      </EmptyState>
    );
  }
  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>
        {fails.length} test{fails.length === 1 ? '' : 's'} failed on the last run. Screenshots are
        saved in the database for people with access to this project (the last 5 per test).
      </p>
      <div className="fail-grid">
        {fails.map(({ t, tc, i }: Any) => (
          <FailureCard key={tc.id} t={t} tc={tc} i={i} />
        ))}
      </div>
    </>
  );
}
