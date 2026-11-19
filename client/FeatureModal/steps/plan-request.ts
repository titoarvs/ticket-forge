'use client';
// Asking the AI to plan the feature: the request streams progress lines and then the plan.
import { type Any, api, aiBody, readNdjson } from '../../core';

export type Source = { filename: string; text: string; file?: File | null };
export type PlanOptions = {
  granularity: string;
  includeTests: boolean;
  testsPerTicket: number;
  instructions: string;
};
type Listeners = {
  /** A progress line (level: 'warn' | 'err' for problems). */
  onLog: (message: string, level?: string) => void;
  /** How many characters the AI has written so far (0 when a new step starts). */
  onChars: (n: number) => void;
};

/** The plan (epics, tickets, summary, open questions). Throws when the AI fails or returns nothing. */
export async function requestPlan(
  projectId: string,
  source: Source,
  options: PlanOptions,
  signal: AbortSignal,
  { onLog, onChars }: Listeners,
) {
  const res = await api(`/api/projects/${projectId}/feature`, {
    method: 'POST',
    raw: true,
    signal,
    body: aiBody({ text: source.text, sourceName: source.filename, options }),
  });
  let out: Any = null;
  await readNdjson(res, (ev) => {
    if (ev.type === 'progress') {
      if (ev.progressChars) onChars(ev.progressChars);
      if (ev.message) {
        onChars(0);
        onLog(ev.message, ev.level);
      }
    } else if (ev.type === 'done') out = ev.result;
    else if (ev.type === 'error') throw new Error(ev.error || ev.message);
  });
  if (!out) throw new Error('The AI didn’t return a plan.');
  return out;
}
