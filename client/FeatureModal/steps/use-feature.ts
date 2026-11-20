'use client';
// The state of "Add feature with AI" across its steps: what to plan from, the options, the run's
// progress, and the plan with the issues picked to add.
import { useState, useRef } from 'react';
import { type Any, P, S, api, keepsOriginal, toast, can } from '../../core';
import { saveEpicDraft } from '../../EpicDrafts';
import type { Step } from '../Step';
import { type Source, type PlanOptions, requestPlan } from './plan-request';

export type LogLine = { message: string; level?: string; done?: boolean };
const TOO_SHORT = 'Describe the feature in a sentence or two, or add a document.';

export function useFeature(initialDoc?: Source) {
  const std = S.status?.generation?.testsPerTicket || 3;
  const [step, setStep] = useState<Step>('input');
  const [mode, setMode] = useState<'describe' | 'document'>(initialDoc ? 'document' : 'describe');
  const [text, setText] = useState('');
  const [doc, setDoc] = useState<Any>(initialDoc || null);
  const [reading, setReading] = useState(false);
  const [opts, setOpts] = useState<PlanOptions>({
    granularity: 'balanced',
    includeTests: true,
    testsPerTicket: std,
    instructions: '',
  });
  const [log, setLog] = useState<LogLine[]>([]);
  const [chars, setChars] = useState(0);
  const [result, setResult] = useState<Any>(null);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [drafted, setDrafted] = useState<Record<string, boolean>>({});
  const ctrl = useRef<AbortController | null>(null);

  const typed = text.trim();
  const source: Source | null =
    mode === 'document' ? doc : typed ? { filename: 'Feature description', text: typed } : null;
  const ready = Boolean(source && source.text.length >= 15);

  /** Reads a document's text (the original PDF or Word file is kept to store with it later). */
  const upload = async (file?: File) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    setReading(true);
    try {
      const r = await api('/api/parse', { method: 'POST', body: fd });
      setDoc({ filename: r.filename, text: r.text, file: keepsOriginal(file) ? file : null });
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setReading(false);
    }
  };
  /** Each new line marks the previous ones done. */
  const push = (message: string, level?: string) =>
    setLog((l) => [...l.map((x) => ({ ...x, done: true })), { message, level }]);
  /** Plans the feature; the answers to the AI's questions are added to the instructions. */
  const generate = async (answers = '') => {
    if (!ready || !source) return toast(TOO_SHORT, 'err');
    ctrl.current = new AbortController();
    setStep('running');
    setLog([{ message: `Sending “${source.filename}” to the AI…` }]);
    setChars(0);
    const instructions = [opts.instructions, answers].filter(Boolean).join('\n\n');
    try {
      const out = await requestPlan(
        P().id,
        source,
        { ...opts, instructions },
        ctrl.current.signal,
        {
          onLog: push,
          onChars: setChars,
        },
      );
      setResult(out);
      setPick(Object.fromEntries(out.tickets.map((t: Any) => [t.id, true])));
      setStep('review');
    } catch (e: Any) {
      if (e.name !== 'AbortError') return push(`Couldn’t plan the feature: ${e.message}`, 'err');
      setStep('input');
      toast('Cancelled');
    }
  };
  /** Before the questions step: is there enough to plan from? */
  const next = () => (ready ? setStep('ask') : toast(TOO_SHORT, 'err'));

  // An epic saved as a draft is kept out of what gets added (its issues stay in the draft).
  const canEpic = can('epic.manage');
  const chosen: Any[] = result
    ? result.tickets.filter((t: Any) => pick[t.id] && !drafted[t.epicId])
    : [];
  const newEpics: Any[] = result
    ? result.epics.filter((e: Any) => !e.existing && chosen.some((t: Any) => t.epicId === e.id))
    : [];
  const draft = async (e: Any, items: Any[]) => {
    if (await saveEpicDraft(e, items)) setDrafted((d) => ({ ...d, [e.id]: true }));
  };
  return {
    std,
    step,
    setStep,
    mode,
    setMode,
    text,
    setText,
    doc,
    setDoc,
    reading,
    opts,
    setOpts,
    log,
    chars,
    result,
    pick,
    setPick,
    drafted,
    source,
    upload,
    generate,
    next,
    cancel: () => ctrl.current?.abort(),
    canEpic,
    chosen,
    newEpics,
    draft,
  };
}
export type Feature = ReturnType<typeof useFeature>;
