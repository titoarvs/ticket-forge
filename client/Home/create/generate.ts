'use client';
// Creating a project from a document: read the file, ask the AI's questions first, then stream the
// generation (progress lines in S.gen) and open the new project's backlog.
import {
  S,
  type Any,
  store,
  emit,
  api,
  keepsOriginal,
  toast,
  readNdjson,
  uploadOriginal,
} from '../../core';
import { askFirst } from '../../Clarify';

/** Changes one generation option and remembers it (except the project key) in this browser. */
export function setGenOpt(k: string, v: Any) {
  S.genOpts = { ...S.genOpts, [k]: v };
  store.set('tf.genOpts', { ...S.genOpts, projectKey: '' });
  emit();
}

/** Reads a document's text into S.doc (the original PDF or Word file is kept to store later). */
export async function readDocument(file: File) {
  const fd = new FormData();
  fd.append('file', file);
  try {
    const r = await api('/api/parse', { method: 'POST', body: fd });
    S.doc = { filename: r.filename, text: r.text, file: keepsOriginal(file) ? file : null };
    emit();
  } catch (e: Any) {
    toast(e.message, 'err');
  }
}

/** A progress line; the earlier ones are marked done. */
function logLine(message: string, level?: string) {
  S.gen.log.forEach((l: Any) => {
    l.done = true;
  });
  S.gen.log.push({ message, level });
  emit();
}

/** Streams the generation and returns the new project. */
async function requestProject(
  text: string,
  sourceName: string,
  answers: string,
  signal: AbortSignal,
) {
  const res = await api('/api/generate', {
    method: 'POST',
    raw: true,
    signal,
    body: {
      text,
      sourceName,
      options: {
        ...S.genOpts,
        instructions: [S.genOpts?.instructions, answers].filter(Boolean).join('\n\n'),
        provider: S.settings.provider || undefined,
        model: S.settings.model || undefined,
        run: S.aiRun && S.aiRun !== 'auto' ? S.aiRun : undefined,
      },
    },
  });
  let project: Any = null;
  await readNdjson(res, (ev) => {
    if (ev.type === 'progress') {
      if (ev.progressChars) {
        S.gen.chars = ev.progressChars;
        emit();
      }
      if (ev.message) {
        S.gen.chars = 0;
        logLine(ev.message, ev.level);
      }
    } else if (ev.type === 'done') project = ev.project;
    else if (ev.type === 'error') throw new Error(ev.error);
  });
  if (!project) throw new Error('Generation ended without a result.');
  return project;
}

/**
 * Keeps the original PDF or Word file so the document can be viewed as it was written (best
 * effort).
 */
async function keepOriginalFile(projectId: string) {
  if (!S.doc?.file) return;
  await uploadOriginal(projectId, S.doc.file, 'original').catch(() =>
    toast(
      'The project was created, but its original file couldn’t be kept. You can attach it on the Source documents page.',
      'err',
    ),
  );
}

/** Cancelled: forget the run. Failed: keep the log with the error. */
function stopped(e: Any) {
  if (e.name === 'AbortError') {
    S.gen = null;
    emit();
    toast('Generation cancelled');
    return;
  }
  S.gen.running = false;
  logLine(`Generation failed: ${e.message}`, 'err');
}

/** Generates a project from the document (or the pasted text) and opens its backlog. */
export async function generateProject(pasted: string) {
  const text = S.doc ? S.doc.text : pasted;
  const sourceName = S.doc ? S.doc.filename : 'Pasted requirements';
  if (text.trim().length < 20)
    return toast('Add a document or paste some requirements first.', 'err');
  if (!S.doc) S.doc = { filename: sourceName, text };
  const answers = await askFirst({
    kind: 'project',
    projectless: true,
    subject: 'the epics, issues and test cases',
    text,
    instructions: S.genOpts?.instructions,
  });
  if (answers === null) return;
  const ctrl = new AbortController();
  S.gen = {
    running: true,
    ctrl,
    chars: 0,
    log: [{ message: `Sending “${sourceName}” to Claude…` }],
  };
  emit();
  try {
    const project = await requestProject(text, sourceName, answers, ctrl.signal);
    await keepOriginalFile(project.id);
    S.gen = null;
    S.doc = null;
    emit();
    toast(`Created ${project.epics.length} epics and ${project.tickets.length} issues`);
    S.nav(`/p/${project.id}/backlog`);
  } catch (e: Any) {
    stopped(e);
  }
}
