'use client';
// Markdown documents written per epic from a template: the Feature Brief (FBD, epic.fbd) and the
// Architecture Record Design (ARD, epic.ard). The AI fills the project's template (or the team's).
// Saved on the epic as Markdown, viewable and editable in the app, downloadable as .md or .docx.
import { useState } from 'react';
import {
  P,
  api,
  downloadFrom,
  saveBlob,
  can,
  mutate,
  toast,
  openModal,
  closeModal,
  readNdjson,
  aiBody,
  me,
  emit,
  startTask,
  type Any,
  type TaskHandle,
} from '../core';
import { Modal } from '../ui';
import { TA } from '../fields';
import { Markdown } from '../GuideCard';
import { askFirst } from '../Clarify';
import { answersNote } from '../../lib/doc-questions';
import { type MdKind, DOC_NAME, markBusy, clearBusy, docBusy } from './shared';

const issuesOf = (e: Any) => P().tickets.filter((t: Any) => t.epicId === e.id).length;
const confirmCount = (md: string) => (md.match(/\[To confirm:/g) || []).length;
const ids = (md: string, re: RegExp) => new Set(md.match(re) || []).size;

type Doc = {
  running: (e: Any) => string;
  about: (e: Any) => string;
  write: (e: Any) => string;
  placeholder: string;
  stat: (md: string) => string;
};
export const DOCS: Record<MdKind, Doc> = {
  fbd: {
    running: (e) =>
      `Filling the Feature Brief template from the epic, its issues${e.psd ? ', its Problem Statement' : ''} and the source documents…`,
    about: (e) =>
      `Your Feature Brief template filled in for this feature: the solution, journeys, acceptance scenarios, personas, KPIs, scope, risks and milestones.${e.psd ? ' It builds on this epic’s Problem Statement.' : ' Tip: write the Problem Statement first; the brief builds on it.'}`,
    write: (e) =>
      `The AI fills your Feature Brief template for ${e.title}: acceptance scenarios (AS-01…) from its ${issuesOf(e)} issues and their acceptance criteria, ${e.psd ? 'the problem and evidence from its Problem Statement, ' : ''}and the source documents.`,
    placeholder: 'e.g. Owner is the Product team. Target release: v2.3. First release to 3 pilots.',
    stat: (md) =>
      [
        ids(md, /AS-\d+/g) && `${ids(md, /AS-\d+/g)} acceptance scenarios`,
        confirmCount(md) && `${confirmCount(md)} points to confirm`,
      ]
        .filter(Boolean)
        .join(' · '),
  },
  ard: {
    running: (e) =>
      `Filling the Architecture Record Design template from the epic${e.fbd ? ', its Feature Brief' : ''} and its issues…`,
    about: (e) =>
      `Your Architecture Record Design template filled in for this feature: design drivers, components, decisions (AD-01…), detailed design, security, rollout, rollback and the verification of each acceptance scenario.${e.fbd ? ' It builds on this epic’s Feature Brief.' : ' Tip: write the Feature Brief first; the ARD reuses its acceptance scenarios and open decisions.'}`,
    write: (e) =>
      `The AI fills your Architecture Record Design template for ${e.title} from its ${issuesOf(e)} issues${e.fbd ? ', its Feature Brief (drivers, AS-xx scenarios, open decisions)' : ''}${e.psd ? ', its Problem Statement' : ''}, the source documents and the project’s repository notes.`,
    placeholder: 'e.g. Use the existing Postgres queue table, not a new broker.',
    stat: (md) =>
      [
        ids(md, /AD-\d+/g) && `${ids(md, /AD-\d+/g)} decisions`,
        confirmCount(md) && `${confirmCount(md)} points to confirm`,
      ]
        .filter(Boolean)
        .join(' · '),
  },
};

const fileName = (k: MdKind, epic: Any, ext: string) =>
  `${DOC_NAME[k]} - ${epic.title} - ${epic[k]?.version || 'v1.0'}.${ext}`.replace(
    /[\\/:*?"<>|]+/g,
    ' ',
  );

async function fetchDoc(k: MdKind, epic: Any, instructions: string, signal: AbortSignal, own: Any) {
  const res = await api(`/api/projects/${P().id}/${k}`, {
    method: 'POST',
    raw: true,
    signal,
    body: aiBody({ epicId: epic.id, instructions }),
  });
  let out: Any = null;
  await readNdjson(res, (ev) => {
    if (ev.type === 'done') out = ev;
    else if (ev.type === 'error') throw new Error(ev.error);
    else if (ev.type === 'progress' && ev.message && own)
      own.update({ detail: `${epic.title} · ${ev.message.replace(/…$/, '')}` });
  });
  if (!out?.markdown) throw new Error(`The AI didn’t return a ${DOC_NAME[k]}.`);
  return out;
}

function saved(k: MdKind, epic: Any, out: Any, notify: boolean) {
  const name = DOC_NAME[k];
  const prev = epic[k];
  mutate(() => {
    epic[k] = {
      markdown: out.markdown,
      generatedAt: new Date().toISOString(),
      generatedBy: me(),
      version: prev?.version || 'v1.0',
      status: prev?.status || 'Draft',
      answers: prev?.answers,
      resolved: prev?.resolved,
    };
  });
  const open = { label: 'Open', onClick: () => openDoc(k, epic) };
  if (out.missing?.length)
    toast(
      `These template sections are missing: ${out.missing.join(', ')}. Edit it or write it again.`,
      'warn',
      { title: `${name} written with gaps`, action: open },
    );
  else if (notify)
    toast(`“${epic.title}” · ${out.markdown.length.toLocaleString()} characters`, 'ok', {
      title: `${name} ready`,
      action: { ...open, label: 'View' },
    });
}

/**
 * Writes one document and saves it on the epic. Shown in the tray (with Cancel) unless `task` is
 * given: then the caller's task (e.g. "Write missing ARDs") shows the progress.
 */
export async function writeDoc(
  k: MdKind,
  epic: Any,
  instructions = '',
  { task, notify = true }: { task?: TaskHandle; notify?: boolean } = {},
): Promise<boolean> {
  const name = DOC_NAME[k];
  if (docBusy(k, epic.id)) {
    toast(`The ${name} for “${epic.title}” is already being written.`, 'info');
    return false;
  }
  const ctrl = new AbortController();
  const own = task
    ? null
    : startTask(`Writing the ${name}`, {
        detail: epic.title,
        kind: 'doc',
        cancel: () => ctrl.abort(),
      });
  markBusy(k, epic.id);
  emit();
  try {
    saved(k, epic, await fetchDoc(k, epic, instructions, ctrl.signal, own), notify);
    own?.finish(`Saved on “${epic.title}”`);
    return true;
  } catch (e: Any) {
    if (e.name === 'AbortError') {
      own?.fail('');
      toast(`Nothing was saved for “${epic.title}”.`, 'info', {
        title: `Stopped writing the ${name}`,
      });
      return false;
    }
    const msg = `Couldn’t write the ${name} for “${epic.title}”: ${e.message}`;
    if (own) own.fail(msg);
    else toast(msg, 'err');
    return false;
  } finally {
    clearBusy(k, epic.id);
    emit();
  }
}

export const downloadDocMd = (k: MdKind, epic: Any) =>
  saveBlob(new Blob([epic[k].markdown], { type: 'text/markdown' }), fileName(k, epic, 'md'));
export async function downloadDocDocx(k: MdKind, epic: Any) {
  try {
    const name = await downloadFrom(`/api/projects/${P().id}/${k}/docx`, {
      body: { epicId: epic.id },
      fallbackName: fileName(k, epic, 'docx'),
    });
    toast(`Downloaded ${name}`);
  } catch (e: Any) {
    toast(`Couldn’t download the ${DOC_NAME[k]}: ${e.message}`, 'err');
  }
}

function WriteModal({ k, epic }: { k: MdKind; epic: Any }) {
  const d = DOCS[k];
  const [text, setText] = useState('');
  const go = async () => {
    closeModal();
    const answers = await askFirst({
      kind: k,
      epicId: epic.id,
      subject: `the ${DOC_NAME[k]} for “${epic.title}”`,
      instructions: text,
    });
    if (answers === null) return;
    await writeDoc(k, epic, [text, answers, answersNote(k, epic[k])].filter(Boolean).join('\n\n'));
  };
  return (
    <Modal
      title={`${epic[k] ? 'Rewrite' : 'Write'} the ${DOC_NAME[k]}`}
      actions={[
        { label: 'Cancel' },
        { label: epic[k] ? 'Rewrite' : 'Write it', kind: 'ai', onClick: go },
      ]}
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        {d.write(epic)} What it can’t know becomes <i>[To confirm: …]</i>. First it asks you a few
        questions; answer what you can or skip them.
        {epic[k] ? ' Your edits to the current one are replaced (you can undo).' : ''}
      </p>
      <label className="field">
        <span>Extra instructions (optional)</span>
        <TA
          value={text}
          rows={3}
          placeholder={d.placeholder}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
    </Modal>
  );
}
export const openWriteDoc = (k: MdKind, epic: Any) => openModal(<WriteModal k={k} epic={epic} />);

function ViewModal({ k, epic }: { k: MdKind; epic: Any }) {
  return (
    <Modal
      title={`${DOC_NAME[k]} · ${epic.title}`}
      wide
      actions={[
        { label: 'Close' },
        { label: 'Download .md', onClick: () => downloadDocMd(k, epic) },
        {
          label: 'Download .docx',
          kind: 'primary',
          onClick: () => downloadDocDocx(k, epic),
          hidden: !can('export'),
        },
      ]}
    >
      <div className="fbd-doc">
        <Markdown text={epic[k].markdown} />
      </div>
    </Modal>
  );
}
export const openDoc = (k: MdKind, epic: Any) => openModal(<ViewModal k={k} epic={epic} />);

function EditModal({ k, epic }: { k: MdKind; epic: Any }) {
  const [md, setMd] = useState(epic[k].markdown);
  const save = () => {
    mutate(() => {
      epic[k] = { ...epic[k], markdown: md, editedAt: new Date().toISOString(), editedBy: me() };
    });
    closeModal();
    toast(`${DOC_NAME[k]} saved`);
  };
  return (
    <Modal
      title={`Edit the ${DOC_NAME[k]} · ${epic.title}`}
      wide
      persistent
      actions={[
        { label: 'Cancel' },
        { label: 'Save', kind: 'primary', onClick: save, disabled: md === epic[k].markdown },
      ]}
    >
      <div className="fbd-edit">
        <TA
          value={md}
          rows={24}
          spellCheck
          onChange={(e) => setMd(e.target.value)}
          aria-label={`${DOC_NAME[k]} (Markdown)`}
        />
        <div className="fbd-doc fbd-preview">
          <Markdown text={md} />
        </div>
      </div>
    </Modal>
  );
}
export const openEditDoc = (k: MdKind, epic: Any) => openModal(<EditModal k={k} epic={epic} />);

/** Epics page: write the documents of one kind that are missing, as one task in the tray. */
export async function writeMissingDocs(k: MdKind) {
  const name = DOC_NAME[k];
  const epics = P().epics.filter((e: Any) => !e[k] && !docBusy(k, e.id));
  if (!epics.length) {
    toast(`Every epic already has a ${name}.`, 'info');
    return;
  }
  let stop = false;
  const task = startTask(`Writing missing ${name}s`, {
    total: epics.length,
    kind: 'doc',
    cancel: () => {
      stop = true;
      task.update({ detail: 'Stopping after the current one…' });
    },
  });
  let ok = 0,
    i = 0;
  for (const e of epics) {
    if (stop) break;
    task.update({ detail: e.title, done: i });
    if (await writeDoc(k, e, '', { task, notify: false })) ok++;
    i++;
  }
  const skipped = epics.length - i;
  if (ok === epics.length) {
    task.finish(`${ok} written`);
    toast(`${ok} ${name}${ok > 1 ? 's' : ''} written and saved on their epics.`, 'ok', {
      title: 'All done',
    });
  } else {
    task.finish(`${ok} of ${epics.length} written`);
    toast(
      `${ok} of ${epics.length} written${skipped ? `, ${skipped} not started (stopped)` : ''}.`,
      ok ? 'warn' : 'err',
      { title: `Missing ${name}s` },
    );
  }
}
