'use client';
// The Epics page's document columns (Problem Statement, Feature Brief, Architecture Record) and
// the "Write for epics without one" items of its AI actions menu.
import { P, can, type Any } from '../core';
import { Ico, I, Spinner } from '../ui';
import { openWritePsd, openPsd, downloadPsd, writeMissingPsds } from './psd';
import { openWriteDoc, openDoc, downloadDocDocx, writeMissingDocs } from './md-docs';
import { type DocKind, DOC_NAME, docBusy } from './shared';

export const DOC_COLUMNS: [DocKind, string][] = [
  ['psd', 'Problem Statement'],
  ['fbd', 'Feature Brief'],
  ['ard', 'Architecture Record'],
];

const open = (k: DocKind, e: Any) => (k === 'psd' ? openPsd(e) : openDoc(k, e));
const write = (k: DocKind, e: Any) => (k === 'psd' ? openWritePsd(e) : openWriteDoc(k, e));
const download = (k: DocKind, e: Any) => (k === 'psd' ? downloadPsd(e) : downloadDocDocx(k, e));
const has = (k: DocKind, e: Any) => Boolean(e[k] && (k === 'psd' || e[k].markdown));

/** One epic's document in the Epics table: its version and status, or "Write with AI". */
export function EpicDocCell({ k, e, label }: { k: DocKind; e: Any; label: string }) {
  const d = e[k];
  return (
    <td
      className="small"
      style={{ whiteSpace: 'nowrap' }}
      data-label={label}
      onClick={(ev) => ev.stopPropagation()}
    >
      {docBusy(k, e.id) ? (
        <span className="muted">
          <Spinner /> Writing…
        </span>
      ) : has(k, e) ? (
        <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
          <button className="link-btn psd-link" onClick={() => open(k, e)}>
            {d.version || 'v1.0'} · {d.status || 'Draft'}
          </button>
          {can('export') && (
            <button
              className="icon-btn"
              title="Download .docx"
              aria-label={`Download the ${DOC_NAME[k]} for ${e.title}`}
              onClick={() => download(k, e)}
            >
              <Ico svg={I.download} />
            </button>
          )}
        </span>
      ) : can('ai.use') && can('epic.manage') ? (
        <button className="link-btn psd-link" onClick={() => write(k, e)}>
          Write with AI
        </button>
      ) : (
        <span className="muted">–</span>
      )}
    </td>
  );
}

/** "Write for epics without one": one item per document, with how many are missing. */
export function MissingDocsMenu() {
  const p = P();
  if (!p.epics.length) return null;
  const item = (k: DocKind, label: string, run: () => void) => {
    const n = p.epics.filter((e: Any) => !has(k, e)).length;
    return (
      <button disabled={!n} onClick={run}>
        <Ico svg={I.doc} />
        {label}
        <small>{n ? `${n} missing` : 'all written'}</small>
      </button>
    );
  };
  return (
    <>
      <hr />
      <div className="mh">Write for epics without one</div>
      {item('psd', 'Problem Statements', writeMissingPsds)}
      {item('fbd', 'Feature Briefs', () => writeMissingDocs('fbd'))}
      {item('ard', 'Architecture Records', () => writeMissingDocs('ard'))}
    </>
  );
}
