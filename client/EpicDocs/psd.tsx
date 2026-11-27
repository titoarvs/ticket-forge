'use client';
// Problem Statement documents (PSD), one per epic: written by the AI in the structure of the
// team's template, saved on the epic, readable in the app and downloadable as a .docx built from
// the template (Administration → Generation, or Project settings → Templates).
import { useState } from 'react';
import {
  P,
  api,
  downloadFrom,
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
import { askFirst } from '../Clarify';
import { answersNote } from '../../lib/doc-questions';
import { PsdDocument } from './psd-document';
import { markBusy, clearBusy, docBusy } from './shared';

type Opts = { task?: TaskHandle; notify?: boolean };

/** Asks the server for the PSD, streaming its progress into `own` (the tray task). */
async function fetchPsd(epic: Any, instructions: string, signal: AbortSignal, own: Any) {
  const res = await api(`/api/projects/${P().id}/psd`, {
    method: 'POST',
    raw: true,
    signal,
    body: aiBody({ epicId: epic.id, instructions }),
  });
  let psd: Any = null;
  await readNdjson(res, (ev) => {
    if (ev.type === 'done') psd = ev.psd;
    else if (ev.type === 'error') throw new Error(ev.error);
    else if (ev.type === 'progress' && ev.message && own)
      own.update({ detail: `${epic.title} · ${ev.message.replace(/…$/, '')}` });
  });
  if (!psd) throw new Error('The AI didn’t return a Problem Statement.');
  return psd;
}

/** Writes the PSD for an epic and saves it on the epic (in the tray, with Cancel). */
export async function writePsd(epic: Any, instructions = '', { task, notify = true }: Opts = {}) {
  if (docBusy('psd', epic.id)) {
    toast(`The Problem Statement for “${epic.title}” is already being written.`, 'info');
    return false;
  }
  const ctrl = new AbortController();
  const own = task
    ? null
    : startTask('Writing the Problem Statement', {
        detail: epic.title,
        kind: 'doc',
        cancel: () => ctrl.abort(),
      });
  markBusy('psd', epic.id);
  emit();
  try {
    const psd = await fetchPsd(epic, instructions, ctrl.signal, own);
    const prev = epic.psd;
    mutate(() => {
      epic.psd = {
        ...psd,
        generatedAt: new Date().toISOString(),
        generatedBy: me(),
        version: prev?.version || 'v1.0',
        status: prev?.status || 'Draft',
        answers: prev?.answers,
        resolved: prev?.resolved,
      };
    });
    own?.finish(`Saved on “${epic.title}”`);
    if (notify)
      toast(`“${epic.title}”`, 'ok', {
        title: 'Problem Statement ready',
        action: { label: 'View', onClick: () => openPsd(epic) },
      });
    return true;
  } catch (e: Any) {
    if (e.name === 'AbortError') {
      own?.fail('');
      toast(`Nothing was saved for “${epic.title}”.`, 'info', {
        title: 'Stopped writing the Problem Statement',
      });
      return false;
    }
    const msg = `Couldn’t write the Problem Statement for “${epic.title}”: ${e.message}`;
    if (own) own.fail(msg);
    else toast(msg, 'err');
    return false;
  } finally {
    clearBusy('psd', epic.id);
    emit();
  }
}

/** Downloads the epic's PSD as .docx (the team's template when uploaded). */
export async function downloadPsd(epic: Any) {
  try {
    const name = await downloadFrom(`/api/projects/${P().id}/psd/docx`, {
      body: { epicId: epic.id },
      fallbackName: `Problem Statement - ${epic.title}.docx`,
    });
    toast(`Downloaded ${name}`);
  } catch (e: Any) {
    toast(`Couldn’t download the Problem Statement: ${e.message}`, 'err');
  }
}

function WriteModal({ epic }: { epic: Any }) {
  const [text, setText] = useState('');
  const go = async () => {
    closeModal();
    const answers = await askFirst({
      kind: 'psd',
      epicId: epic.id,
      subject: `the Problem Statement for “${epic.title}”`,
      instructions: text,
    });
    if (answers === null) return;
    await writePsd(
      epic,
      [text, answers, answersNote('psd', epic.psd)].filter(Boolean).join('\n\n'),
    );
  };
  const issues = P().tickets.filter((t: Any) => t.epicId === epic.id).length;
  return (
    <Modal
      title={`${epic.psd ? 'Rewrite' : 'Write'} the Problem Statement`}
      actions={[
        { label: 'Cancel' },
        { label: epic.psd ? 'Rewrite' : 'Write it', kind: 'ai', onClick: go },
      ]}
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        The AI writes it from <b>{epic.title}</b>, its {issues} issues, the project description and
        the source documents, in the sections of your template: At a Glance, Background, Problem
        Statement, Who Is Affected, business and user impact, Cost of Inaction and Evidence Needed.
        {epic.psd ? ' The current one is replaced (you can undo).' : ''}
      </p>
      <label className="field">
        <span>Extra instructions (optional)</span>
        <TA
          value={text}
          rows={3}
          placeholder="e.g. Focus on the payroll officers. Mention the BIR deadline."
          onChange={(e) => setText(e.target.value)}
        />
      </label>
    </Modal>
  );
}
export const openWritePsd = (epic: Any) => openModal(<WriteModal epic={epic} />);

function ViewModal({ epic }: { epic: Any }) {
  return (
    <Modal
      title={`Problem Statement · ${epic.title}`}
      wide
      actions={[
        { label: 'Close' },
        {
          label: 'Download .docx',
          kind: 'primary',
          onClick: () => downloadPsd(epic),
          hidden: !can('export'),
        },
      ]}
    >
      <PsdDocument psd={epic.psd} />
    </Modal>
  );
}
export const openPsd = (epic: Any) => openModal(<ViewModal epic={epic} />);

/** Epics page: write the PSDs that are missing, one after another, as one task in the tray. */
export async function writeMissingPsds() {
  const epics = P().epics.filter((e: Any) => !e.psd && !docBusy('psd', e.id));
  if (!epics.length) {
    toast('Every epic already has a Problem Statement.', 'info');
    return;
  }
  let stop = false;
  const task = startTask('Writing missing Problem Statements', {
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
    if (await writePsd(e, '', { task, notify: false })) ok++;
    i++;
  }
  const skipped = epics.length - i;
  if (ok === epics.length) {
    task.finish(`${ok} written`);
    toast(`${ok} Problem Statement${ok > 1 ? 's' : ''} written and saved on their epics.`, 'ok', {
      title: 'All done',
    });
  } else {
    task.finish(`${ok} of ${epics.length} written`);
    toast(
      `${ok} of ${epics.length} written${skipped ? `, ${skipped} not started (stopped)` : ''}.`,
      ok ? 'warn' : 'err',
      { title: 'Missing Problem Statements' },
    );
  }
}
export const psdBusy = (id: string) => docBusy('psd', id);
