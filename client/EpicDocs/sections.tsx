'use client';
// The epic panel's document sections: Problem Statement, Feature Brief and Architecture Record
// Design. Each shows "Write with AI" until there is one, then its summary, actions, version and
// status.
import type { ReactNode } from 'react';
import { can, mutate, openModal, ago, type Any } from '../core';
import { Ico, I, Confirm } from '../ui';
import { TF, SF, MenuItem } from '../fields';
import { DriveState } from '../Drive';
import { openWritePsd, openPsd, downloadPsd } from './psd';
import { OpenQuestions } from './open-questions';
import {
  DOCS,
  openWriteDoc,
  openDoc,
  openEditDoc,
  downloadDocDocx,
  downloadDocMd,
} from './md-docs';
import {
  type DocKind,
  type MdKind,
  DOC_NAME,
  STATUSES,
  Running,
  docBusy,
  busySince,
  setDocStatus,
  syncDocControl,
} from './shared';

function setField(epic: Any, k: DocKind, key: string, v: string) {
  if (key === 'status') return setDocStatus(epic, k, v);
  mutate(
    () => {
      const next = { ...epic[k], [key]: v };
      epic[k] =
        k === 'psd'
          ? next
          : {
              ...next,
              markdown: syncDocControl(
                k,
                next.markdown,
                next.version || 'v1.0',
                next.status || 'Draft',
              ),
            };
    },
    { tag: `${k}.${key}${epic.id}` },
  );
}

/** Version, status and remove: the right end of a written document's actions. */
function Meta({ epic, k }: { epic: Any; k: DocKind }) {
  const ed = can('epic.manage');
  const d = epic[k];
  const name = DOC_NAME[k];
  const remove = () =>
    openModal(
      <Confirm
        title={`Remove this ${name}?`}
        label="Remove"
        text="You can undo with ⌘Z, or write it again."
        onYes={() =>
          mutate(() => {
            delete epic[k];
          })
        }
      />,
    );
  return (
    <>
      <span className="spacer" />
      <label className="psd-meta">
        <span className="muted small">Version</span>
        <TF
          disabled={!ed}
          value={d.version || 'v1.0'}
          onChange={(e: Any) => setField(epic, k, 'version', e.target.value)}
          sx={{ width: 76 }}
        />
      </label>
      <label className="psd-meta">
        <span className="muted small">Status</span>
        <SF
          disabled={!ed}
          value={d.status || 'Draft'}
          onChange={(e: Any) => setField(epic, k, 'status', e.target.value)}
        >
          {STATUSES.map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </SF>
      </label>
      {ed && (
        <button
          className="icon-btn"
          title={`Remove the ${name}`}
          aria-label={`Remove the ${name}`}
          onClick={remove}
        >
          <Ico svg={I.trash} />
        </button>
      )}
    </>
  );
}

type ShellProps = {
  epic: Any;
  k: DocKind;
  about: string;
  running: string;
  onWrite: () => void;
  children: ReactNode;
};
/** The section around one document: its title, Drive state, and the empty / running states. */
function Shell({ epic, k, about, running, onWrite, children }: ShellProps) {
  const d = epic[k];
  const name = DOC_NAME[k];
  const canWrite = can('ai.use') && can('epic.manage');
  const written = d && (k === 'psd' || d.markdown);
  return (
    <div className="sec psd-sec">
      <div className="sec-title">
        <h3>{name}</h3>
        {written && <DriveState epic={epic} kind={k} again={d.generatedAt} />}
        {written && (
          <span className="muted small" style={{ marginLeft: 'auto' }}>
            Written {ago(d.generatedAt)}
            {d.generatedBy ? ` by ${d.generatedBy}` : ''}
            {d.editedAt ? ` · edited ${ago(d.editedAt)}` : ''}
          </span>
        )}
      </div>
      {docBusy(k, epic.id) ? (
        <Running text={running} since={busySince(k, epic.id)} />
      ) : !written ? (
        <div className="psd-empty">
          <p className="muted small" style={{ margin: '0 0 8px' }}>
            {about}
          </p>
          {canWrite ? (
            <button className="btn ai" onClick={onWrite}>
              <Ico svg={I.sparkle} />
              Write {name} with AI
            </button>
          ) : (
            <span className="muted small">
              Ask someone who can use the AI and manage epics to write it.
            </span>
          )}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

/** The "Problem Statement" section of the epic panel. */
export function PsdSection({ epic }: { epic: Any }) {
  const psd = epic.psd;
  const canWrite = can('ai.use') && can('epic.manage');
  return (
    <Shell
      epic={epic}
      k="psd"
      about="A PSD for this feature in your template’s structure: what’s wrong today, who it hurts, what it costs and what evidence is needed."
      running="Writing the Problem Statement from the epic, its issues and the source documents…"
      onWrite={() => openWritePsd(epic)}
    >
      {psd && (
        <>
          <div className="psd-glance">
            {psd.atAGlance?.problem && (
              <p>
                <b>The problem:</b> {psd.atAGlance.problem}
              </p>
            )}
            {psd.atAGlance?.whyItMatters && (
              <p>
                <b>Why it matters:</b> {psd.atAGlance.whyItMatters}
              </p>
            )}
            <p className="muted small">
              {(psd.affected || []).length} groups affected · {(psd.users || []).length} user roles
              · {(psd.evidence || []).length} evidence items
            </p>
          </div>
          <div className="row psd-actions">
            <button className="btn sm" onClick={() => openPsd(epic)}>
              <Ico svg={I.doc} />
              View
            </button>
            {can('export') && (
              <button className="btn sm primary" onClick={() => downloadPsd(epic)}>
                <Ico svg={I.download} />
                Download .docx
              </button>
            )}
            {canWrite && (
              <button className="btn sm ai" onClick={() => openWritePsd(epic)}>
                <Ico svg={I.sparkle} />
                Rewrite
              </button>
            )}
            <Meta epic={epic} k="psd" />
          </div>
          <OpenQuestions k="psd" epic={epic} />
        </>
      )}
    </Shell>
  );
}

/** The first plain line of the document's first section, as its summary. */
const glanceOf = (md: string) =>
  ((md.split(/^##\s+/m)[1] || '').split('\n').slice(1) as string[])
    .find((l) => l.trim() && !l.startsWith('|') && !l.startsWith('<!--'))
    ?.replace(/\*\*/g, '')
    .replace(/^[-\d.]+\s*/, '') || '';

/** A Markdown document's section in the epic panel (Feature Brief, Architecture Record Design). */
export function DocSection({ k, epic }: { k: MdKind; epic: Any }) {
  const d = DOCS[k];
  const f = epic[k];
  const canWrite = can('ai.use') && can('epic.manage');
  const glance = f?.markdown ? glanceOf(f.markdown) : '';
  return (
    <Shell
      epic={epic}
      k={k}
      about={d.about(epic)}
      running={d.running(epic)}
      onWrite={() => openWriteDoc(k, epic)}
    >
      {f?.markdown && (
        <>
          {glance && (
            <div className="psd-glance">
              <p>{glance}</p>
              <p className="muted small">{d.stat(f.markdown)}</p>
            </div>
          )}
          <div className="row psd-actions">
            <button className="btn sm" onClick={() => openDoc(k, epic)}>
              <Ico svg={I.doc} />
              View
            </button>
            {can('epic.manage') && (
              <button className="btn sm" onClick={() => openEditDoc(k, epic)}>
                <Ico svg={I.pencil} />
                Edit
              </button>
            )}
            {can('export') && (
              <button className="btn sm primary" onClick={() => downloadDocDocx(k, epic)}>
                <Ico svg={I.download} />
                .docx
              </button>
            )}
            <button className="btn sm" onClick={() => downloadDocMd(k, epic)}>
              <Ico svg={I.download} />
              .md
            </button>
            {canWrite && (
              <button className="btn sm ai" onClick={() => openWriteDoc(k, epic)}>
                <Ico svg={I.sparkle} />
                Rewrite
              </button>
            )}
            <Meta epic={epic} k={k} />
          </div>
          <OpenQuestions k={k} epic={epic} />
        </>
      )}
    </Shell>
  );
}

/** All three, in workflow order. */
export function EpicDocSections({ epic }: { epic: Any }) {
  return (
    <>
      <PsdSection epic={epic} />
      <DocSection k="fbd" epic={epic} />
      <DocSection k="ard" epic={epic} />
    </>
  );
}
