'use client';
// What the three epic documents share: the Problem Statement (PSD, epic.psd), the Feature Brief
// (FBD, epic.fbd) and the Architecture Record Design (ARD, epic.ard). Their statuses, who is
// writing which one right now, and the in-place "writing…" state on the epic panel.
import { mutate, me, type Any } from '../core';
import { Spinner, Elapsed } from '../ui';

export type DocKind = 'psd' | 'fbd' | 'ard';
export type MdKind = 'fbd' | 'ard';
export const STATUSES = ['Draft', 'For Review', 'Approved'];
export const DOC_NAME: Record<DocKind, string> = {
  psd: 'Problem Statement',
  fbd: 'Feature Brief',
  ard: 'Architecture Record Design',
};
const HEADING: Record<MdKind, string> = {
  fbd: 'Feature Brief for',
  ard: 'Architecture Record Design for',
};

// "<kind>:<epic id>" → started at
const busy = new Map<string, number>();
const bk = (k: DocKind, id: string) => `${k}:${id}`;
export const docBusy = (k: DocKind, id: string) => busy.has(bk(k, id));
export const busySince = (k: DocKind, id: string) => busy.get(bk(k, id)) || Date.now();
export const markBusy = (k: DocKind, id: string) => busy.set(bk(k, id), Date.now());
export const clearBusy = (k: DocKind, id: string) => busy.delete(bk(k, id));

/** Updates the version and status in a Markdown document's Document Control table. */
export function syncDocControl(k: MdKind, md: string, version: string, status: string) {
  const re = new RegExp(
    `(\\|\\s*${HEADING[k]}[^|]*\\|\\s*)([^|]*)(\\|\\s*[^|]*\\|\\s*)([^|]*)(\\|)`,
    'i',
  );
  return md.replace(re, (_m, a, _v, c, _s, e) => `${a}${version} ${c}${status} ${e}`);
}

/** Sets a document's status, and records who approved it (and when) when it is Approved. */
export function setDocStatus(epic: Any, k: DocKind, status: string) {
  mutate(
    () => {
      let next = { ...epic[k], status };
      if (k !== 'psd')
        next = {
          ...next,
          markdown: syncDocControl(k, next.markdown, next.version || 'v1.0', status),
        };
      const approved =
        status === 'Approved'
          ? { approvedAt: new Date().toISOString(), approvedBy: me() }
          : { approvedAt: undefined, approvedBy: undefined };
      epic[k] = { ...next, ...approved };
    },
    { tag: `${k}.status${epic.id}` },
  );
}

/** The in-place "writing…" state: what is happening, how long it has run, that you can go on. */
export function Running({ text, since }: { text: string; since: number }) {
  return (
    <div className="ai-running" role="status">
      <div className="run-line">
        <Spinner />
        <span>{text}</span>
        <Elapsed since={since} />
      </div>
      <div className="run-bar">
        <span />
      </div>
      <span className="run-hint">
        Usually 1–3 minutes. You can keep working; it’s also in the tray at the bottom right.
      </span>
    </div>
  );
}
