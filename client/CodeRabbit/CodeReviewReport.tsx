'use client';
import { useState } from 'react';
import Link from 'next/link';
import { P, type Any, ago } from '../core';
import { openDrawer } from '../actions';
import {
  SEVS,
  FINDING_STATUS,
  SevChip,
  SEV_LABEL,
  where,
  fileBug,
  setStatus,
} from './CodeRabbitPanel';

/** Reports → Code review findings: every saved CodeRabbit review in the project. */
export function CodeReviewReport() {
  const p = P();
  const rows: { t: Any; r: Any; f: Any }[] = p.tickets.flatMap((t: Any) =>
    (t.codeReviews || []).flatMap((r: Any) => r.findings.map((f: Any) => ({ t, r, f }))),
  );
  const [sev, setSev] = useState('');
  if (!rows.length)
    return (
      <div className="card wide">
        <h3>Code review findings</h3>
        <p className="sub">CodeRabbit findings on the code the agents write.</p>
        <p className="muted small">
          No CodeRabbit reviews yet. Open an issue’s <b>Write code with AI</b> job and choose{' '}
          <b>CodeRabbit review</b> once the agent finishes.
        </p>
      </div>
    );
  const reviews = p.tickets.reduce((n: number, t: Any) => n + (t.codeReviews || []).length, 0);
  const count = (fn: (x: { f: Any }) => boolean) => rows.filter(fn).length;
  const files = Object.entries(
    rows.reduce((m: Record<string, number>, x) => {
      m[x.f.file] = (m[x.f.file] || 0) + 1;
      return m;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const openSerious = rows
    .filter((x) => x.f.status === 'open' && (!sev || x.f.severity === sev))
    .sort((a, b) => SEVS.indexOf(a.f.severity) - SEVS.indexOf(b.f.severity));
  const max = Math.max(1, ...SEVS.map((s) => count((x) => x.f.severity === s)));
  return (
    <div className="card wide cr-report">
      <h3>Code review findings</h3>
      <p className="sub">
        {rows.length} CodeRabbit findings from {reviews} review{reviews === 1 ? '' : 's'} on{' '}
        {new Set(rows.map((x) => x.t.id)).size} issues.
      </p>
      <div className="cr-kpis">
        {Object.entries(FINDING_STATUS).map(([k, label]) => (
          <div key={k} className="cr-kpi">
            <b>{count((x) => x.f.status === k)}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="cr-grid">
        <div>
          <h4>By severity</h4>
          {SEVS.map((s) => {
            const n = count((x) => x.f.severity === s);
            return (
              <button
                key={s}
                className={`cr-bar ${sev === s ? 'on' : ''}`}
                onClick={() => setSev(sev === s ? '' : s)}
                title="Filter the open findings below"
              >
                <SevChip s={s} />
                <span className="cr-track">
                  <i className={`sev-${s}`} style={{ width: `${(n / max) * 100}%` }} />
                </span>
                <b>{n}</b>
              </button>
            );
          })}
        </div>
        <div>
          <h4>Files with the most findings</h4>
          <table className="tbl">
            <tbody>
              {files.map(([f, n]) => (
                <tr key={f}>
                  <td>
                    <code className="small">{f}</code>
                  </td>
                  <td className="num">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <h4>
        Open findings{sev ? ` · ${SEV_LABEL[sev]}` : ''}{' '}
        <span className="muted small">({openSerious.length})</span>
      </h4>
      {openSerious.length ? (
        <table className="tbl">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Finding</th>
              <th>Issue</th>
              <th>Found</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {openSerious.slice(0, 50).map(({ t, r, f }) => (
              <tr key={`${r.id}-${f.id}`}>
                <td>
                  <SevChip s={f.severity} />
                </td>
                <td>
                  <div>{f.title}</div>
                  <code className="muted small">{where(f)}</code>
                </td>
                <td>
                  <Link
                    href={`/p/${p.id}/backlog`}
                    onClick={(e) => {
                      e.preventDefault();
                      openDrawer('issue', t.id);
                    }}
                  >
                    {t.key}
                  </Link>{' '}
                  <span className="muted small">{r.origin === 'pr' ? r.prRef : r.side}</span>
                </td>
                <td className="muted small">{ago(r.at)}</td>
                <td>
                  <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    <button className="btn sm" onClick={() => fileBug(t, r, f)}>
                      File as bug
                    </button>
                    <button className="btn sm subtle" onClick={() => setStatus(f, 'dismissed')}>
                      Dismiss
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small">Nothing open{sev ? ' at this severity' : ''}. </p>
      )}
    </div>
  );
}
