// Approval of an epic's documents (Problem Statement, Feature Brief, Architecture Record Design). Issues are written from
// an epic only when all three are approved, and only from the approved version: a document edited after it was approved
// has to be approved again. Shared by the server and the browser.
export type DocKind = 'psd' | 'fbd' | 'ard';
export const APPROVAL_DOCS: { kind: DocKind; label: string; short: string }[] = [
  { kind: 'psd', label: 'Problem Statement', short: 'PSD' },
  { kind: 'fbd', label: 'Feature Brief', short: 'FBD' },
  { kind: 'ard', label: 'Architecture Record Design', short: 'ARD' },
];
// Fields that describe the document rather than being it: they don't count as an edit.
const META = new Set(['status', 'approvedAt', 'approvedBy', 'approvedFp', 'generatedAt', 'generatedBy', 'editedAt', 'editedBy']);

/** A short fingerprint of what the document says (FNV-1a over its content, ignoring status and who/when fields). */
export function fingerprint(doc: any): string {
  const keep: any = {};
  for (const k of Object.keys(doc || {}).sort()) if (!META.has(k)) keep[k] = doc[k];
  const text = JSON.stringify(keep);
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0; b = Math.imul(b + text.charCodeAt(i), 0x85ebca6b) >>> 0; }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** What to store on a document when its status is set: who approved which version, or nothing to remember. */
export function approvalStamp(doc: any, by: string, at = new Date().toISOString()) {
  return doc?.status === 'Approved' ? { approvedAt: at, approvedBy: by, approvedFp: fingerprint(doc) } : { approvedAt: undefined, approvedBy: undefined, approvedFp: undefined };
}

export type DocState = 'missing' | 'draft' | 'review' | 'approved' | 'changed';
export const STATE_LABEL: Record<DocState, string> = { missing: 'Not written', draft: 'Draft', review: 'For review', approved: 'Approved', changed: 'Changed after approval' };

/** One document's approval state. Approved before approvals were tracked (no fingerprint) counts as approved. */
export function docState(epic: any, kind: DocKind): DocState {
  const d = epic?.[kind];
  if (!d || (kind !== 'psd' && !d.markdown)) return 'missing';
  if (d.status === 'Approved') return d.approvedFp && d.approvedFp !== fingerprint(d) ? 'changed' : 'approved';
  return d.status === 'For Review' ? 'review' : 'draft';
}

/** The three documents' states and whether issues can be written: { ok, docs: [{ kind, label, state, version }], blocking: string }. */
export function approvalCheck(epic: any) {
  const docs = APPROVAL_DOCS.map((x) => ({ ...x, state: docState(epic, x.kind), version: epic?.[x.kind]?.version || '', approvedBy: epic?.[x.kind]?.approvedBy || '', approvedAt: epic?.[x.kind]?.approvedAt || '' }));
  const bad = docs.filter((d) => d.state !== 'approved');
  const blocking = bad.map((d) => `${d.label} (${STATE_LABEL[d.state].toLowerCase()})`).join(', ');
  return { ok: !bad.length, docs, blocking };
}
