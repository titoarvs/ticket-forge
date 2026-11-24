'use client';
import { useState } from 'react';
import { type Any, copyText, can, S, emit, openModal } from '../core';
import { Ico, I } from '../ui';
import { runTests } from '../actions';
import { ShotModal } from '../views';

const fmtMs = (ms: number) =>
  !ms
    ? ''
    : ms < 1000
      ? `${ms} ms`
      : ms < 60000
        ? `${(ms / 1000).toFixed(1)} s`
        : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;
const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u || '';
  }
};
const CAT_CLS: Record<string, string> = {
  'app-bug': 'bug',
  'test-script': 'script',
  'test-data': 'script',
  environment: 'env',
  flaky: 'env',
  'needs-info': 'info',
};
const OWNER_TXT: Record<string, string> = { developer: 'Developer', qa: 'QA', devops: 'DevOps' };
/**
 * The AI's failure analysis on one failed test: what broke, why, the evidence and what to do next.
 */
function FailAnalysis({ a, t, tcId, title }: { a: Any; t: Any; tcId: string; title: string }) {
  const [more, setMore] = useState(false);
  const tc = t.testCases.find((x: Any) => x.id === tcId);
  const report = () =>
    copyText(
      [
        `${title}`,
        `Category: ${a.label} (${a.confidence} confidence) · Owner: ${OWNER_TXT[a.owner] || a.owner}`,
        a.summary,
        a.failedStep && `Failed at: ${a.failedStep}`,
        a.expected && `Expected: ${a.expected}`,
        a.actual && `Actual: ${a.actual}`,
        a.cause && `Likely cause: ${a.cause}`,
        a.evidence?.length && `Evidence:\n${a.evidence.map((e: string) => `- ${e}`).join('\n')}`,
        a.fix && `Fix: ${a.fix}`,
        a.nextSteps?.length &&
          `Next steps:\n${a.nextSteps.map((x: string, i: number) => `${i + 1}. ${x}`).join('\n')}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
  return (
    <div className={`fa fa-${CAT_CLS[a.category] || 'info'}`}>
      <div className="fa-h">
        <Ico svg={I.sparkle} />
        <b>{a.label}</b>
        <span className="fa-tag">{a.confidence} confidence</span>
        <span className="fa-tag">Owner: {OWNER_TXT[a.owner] || a.owner}</span>
      </div>
      <p className="fa-sum">{a.summary}</p>
      {(a.expected || a.actual) && (
        <div className="fa-ea">
          {a.expected && (
            <div>
              <span>Expected</span>
              {a.expected}
            </div>
          )}
          {a.actual && (
            <div>
              <span>Actual</span>
              {a.actual}
            </div>
          )}
        </div>
      )}
      {a.cause && (
        <div className="fa-row">
          <span>Likely cause</span>
          <p>{a.cause}</p>
        </div>
      )}
      {a.fix && (
        <div className="fa-row">
          <span>Fix</span>
          <p>{a.fix}</p>
        </div>
      )}
      {more && (
        <>
          {a.failedStep && (
            <div className="fa-row">
              <span>Failed at</span>
              <p>{a.failedStep}</p>
            </div>
          )}
          {a.evidence?.length > 0 && (
            <div className="fa-row">
              <span>Evidence</span>
              <ul>
                {a.evidence.map((e: string, i: number) => (
                  <li key={i}>
                    <code>{e}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {a.nextSteps?.length > 0 && (
            <div className="fa-row">
              <span>Next steps</span>
              <ol>
                {a.nextSteps.map((x: string, i: number) => (
                  <li key={i}>{x}</li>
                ))}
              </ol>
            </div>
          )}
          {a.scriptFix && (
            <div className="fa-row">
              <span>Script fix</span>
              <pre className="run-err-full">{a.scriptFix}</pre>
            </div>
          )}
        </>
      )}
      <div className="fa-actions">
        {(a.failedStep || a.evidence?.length || a.nextSteps?.length || a.scriptFix) && (
          <button className="link-btn small" onClick={() => setMore(!more)}>
            {more ? 'Less' : 'Evidence and next steps'}
          </button>
        )}
        <button className="link-btn small" onClick={report}>
          Copy as bug report
        </button>
        {tc &&
          ['test-script', 'test-data', 'flaky'].includes(a.category) &&
          can('test.run') &&
          can('ai.use') && (
            <button
              className="link-btn small"
              onClick={() => runTests([{ t, tc }], { regenerate: true })}
            >
              Rewrite the script and re-run
            </button>
          )}
      </div>
    </div>
  );
}
/**
 * An automated test-run comment, made readable: a pass/fail summary, then each test with its error
 * and screenshot.
 */
export function AutoBody({ c, t }: { c: Any; t: Any }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Older comments only listed failures.
  const results: Any[] =
    c.results || (c.failures || []).map((f: Any) => ({ ...f, status: 'Fail' }));
  const failed = results.filter((r) => r.status !== 'Pass');
  const passed = results.length - failed.length;
  const ok = !failed.length;
  const mention = !ok && (c.body.match(/^@(.+?) \d+ (?:of \d+ )?automated/) || [])[1];
  const total = c.durationMs || results.reduce((n, r) => n + (r.durationMs || 0), 0);
  const rerun = () =>
    runTests(
      failed
        .map((r) => ({ t, tc: t.testCases.find((x: Any) => x.id === r.tcId) }))
        .filter((x) => x.tc),
    );
  return (
    <div className={`run-card ${ok ? 'pass' : 'fail'}`}>
      <div className="run-head">
        <span className={`run-badge ${ok ? 'pass' : 'fail'}`}>
          <Ico svg={ok ? I.check : I.warn} />
          {ok ? 'Passed' : 'Failed'}
        </span>
        <b>
          {ok
            ? `All ${results.length} test${results.length === 1 ? '' : 's'} passed`
            : `${failed.length} of ${results.length} test${results.length === 1 ? '' : 's'} failed`}
        </b>
        {mention && <span className="mention">@{mention}</span>}
        <span className="spacer" />
        {!ok && can('test.run') && (
          <button className="btn sm" onClick={rerun}>
            <Ico svg={I.play} />
            Re-run failed
          </button>
        )}
      </div>
      <div className="run-bar" role="img" aria-label={`${passed} passed, ${failed.length} failed`}>
        {passed > 0 && <i className="p" style={{ flex: passed }} />}
        {failed.length > 0 && <i className="f" style={{ flex: failed.length }} />}
      </div>
      <div className="run-meta muted small">
        <span>
          <Ico svg={I.check} className="ok" /> {passed} passed
        </span>
        <span>
          <Ico svg={I.close} className="bad" /> {failed.length} failed
        </span>
        {total > 0 && (
          <span>
            <Ico svg={I.clock} /> {fmtMs(total)}
          </span>
        )}
        <span>Run by {c.runBy || 'a teammate'}</span>
        {c.baseUrl && (
          <span title={c.baseUrl}>
            on <code>{hostOf(c.baseUrl)}</code>
          </span>
        )}
      </div>
      <ul className="run-list">
        {[...failed, ...results.filter((r) => r.status === 'Pass')].map((r) => {
          const bad = r.status !== 'Pass';
          const first = String(r.error || '').split('\n')[0];
          const more = bad && (String(r.error || '').length > first.length || r.screenshot);
          return (
            <li key={r.tcId} className={bad ? 'bad' : 'good'}>
              <div className="run-row">
                <Ico svg={bad ? I.close : I.check} className={bad ? 'bad' : 'ok'} />
                <div className="run-main">
                  <span className="run-title" title={r.title}>
                    {r.title}
                  </span>
                  <span className="run-sub">
                    <a
                      href={`#tc-${r.tcId}`}
                      className="key"
                      onClick={(e) => {
                        e.preventDefault();
                        S.openTc.add(r.tcId);
                        emit();
                        setTimeout(
                          () =>
                            document
                              .getElementById(`tc-${r.tcId}`)
                              ?.scrollIntoView({ block: 'center' }),
                          50,
                        );
                      }}
                    >
                      {r.key}
                    </a>
                    {r.durationMs > 0 && <span className="run-ms">{fmtMs(r.durationMs)}</span>}
                    {r.healed && (
                      <span className="heal-chip" title={`Was failing: ${r.healed.error || ''}`}>
                        Self-healed: {r.healed.reason}
                      </span>
                    )}
                  </span>
                </div>
              </div>
              {bad && r.analysis && (
                <FailAnalysis a={r.analysis} t={t} tcId={r.tcId} title={`${r.key} ${r.title}`} />
              )}
              {bad && (
                <div className="run-err">
                  <code className="run-err-1">{first || 'Failed'}</code>
                  {more && (
                    <button
                      className="link-btn small"
                      onClick={() => setOpen({ ...open, [r.tcId]: !open[r.tcId] })}
                    >
                      {open[r.tcId] ? 'Hide details' : 'Details'}
                    </button>
                  )}
                  {open[r.tcId] && (
                    <>
                      {String(r.error || '').length > first.length && (
                        <pre className="run-err-full">{r.error}</pre>
                      )}
                      {r.screenshot && (
                        <button
                          className="run-shot"
                          onClick={() =>
                            openModal(
                              <ShotModal
                                url={r.screenshot}
                                title={`${r.key} ${r.title}`}
                                error={r.error}
                                at={c.at}
                              />,
                            )
                          }
                        >
                          <img
                            src={r.screenshot}
                            alt={`Screenshot when ${r.key} failed`}
                            loading="lazy"
                          />
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
