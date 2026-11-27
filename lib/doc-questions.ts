// Open questions of an epic document (Problem Statement, Feature Brief, Architecture Record
// Design): every point the AI marked "[To confirm: …]" (or "[To validate with Sales: …]"), and,
// in the Markdown documents, every open decision row ("| Q01 | question | owner | due | Open |").
// People answer them on the epic (doc.answers, by question id); the AI then updates the document
// with the answers (lib/doc-answers.ts). Answered questions that left the document are kept in
// doc.resolved. Shared by the server and the browser: no imports.

export type OpenQuestion = {
  id: string;
  text: string;
  code: string;
  kind: 'confirm' | 'decision';
  /** Where it is: the section heading, and the line it sits in (the point itself shown as ▢). */
  section: string;
  line: string;
};
export type Answered = { question: string; answer: string; by?: string; at?: string };

const MARKER = /\[(To confirm|To validate)([^\]:]*):\s*([^\]]+)\]/gi;
const DECISION = /^\|\s*(Q\d+)\s*\|([^|]*)\|(.*)\|\s*$/;
const CLOSED = /resolved|closed|decided|done|answered/i;
// Fields that describe a document rather than being it.
const META = new Set([
  'status',
  'version',
  'answers',
  'resolved',
  'generatedAt',
  'generatedBy',
  'editedAt',
  'editedBy',
  'revisedAt',
  'revisedBy',
  'approvedAt',
  'approvedBy',
]);

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** A short stable id for a question (FNV-1a of its normalized text). */
export function questionId(text: string) {
  let h = 0x811c9dc5;
  const t = norm(text);
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193) >>> 0;
  return `q${h.toString(36)}`;
}

/** Every string a Problem Statement says (it is JSON, not Markdown). */
function textsOf(v: any, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => textsOf(x, out));
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) if (!META.has(k)) textsOf(x, out);
  return out;
}

const HEADING = /^#{1,4}\s+(.+?)\s*$/;
/** A line as plain text: table cells joined with " · ", no list bullets or bold. */
const plain = (line: string) =>
  line
    .replace(/^\s*([-*]|\d+\.)\s+/, '')
    .replace(/\*\*/g, '')
    .split('|')
    .map((c) => c.trim())
    .filter(Boolean)
    .join(' · ')
    .trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The [To confirm: …] points of one line, with the line around them as context. */
function markersIn(line: string, section: string): OpenQuestion[] {
  return [...line.matchAll(MARKER)].map((m) => {
    const who = m[2].trim();
    const q = m[3].trim();
    const ctx = plain(line.replace(m[0], '▢').replace(MARKER, (_x, _a, _b, t) => `[${t.trim()}]`));
    return {
      id: questionId(`${q}|${ctx}`),
      text: who ? `${q} (${m[1].toLowerCase()} ${who})` : q,
      code: '',
      kind: 'confirm' as const,
      section,
      line: ctx === '▢' ? '' : clip(ctx, 180),
    };
  });
}

/** Walks a Markdown document: open decision rows and [To confirm: …] points, in order. */
function fromMarkdown(md: string): OpenQuestion[] {
  const decisions: OpenQuestion[] = [];
  const points: OpenQuestion[] = [];
  let section = '';
  for (const line of md.split('\n')) {
    const h = line.match(HEADING);
    if (h) {
      section = h[1].replace(/\*\*/g, '');
      continue;
    }
    const m = line.match(DECISION);
    const q = m?.[2].trim() || '';
    const status = m?.[3].split('|').pop() || '';
    // The template's own example row is all [bracketed prompts].
    if (m && q && !/^\[.*\]$/.test(q) && !CLOSED.test(status)) {
      const rest = plain(m[3]);
      decisions.push({
        id: questionId(`${m[1]} ${q}`),
        text: q,
        code: m[1],
        kind: 'decision',
        section,
        line: rest ? `Owner, due, status: ${clip(rest, 140)}` : '',
      });
      continue; // its own [To confirm] cells belong to the decision
    }
    points.push(...markersIn(line, section));
  }
  return [...decisions, ...points];
}

/** The open questions of a document, in the order they appear, without repeats (at most 100). */
export function openQuestions(kind: string, doc: any): OpenQuestion[] {
  if (!doc) return [];
  const all =
    kind === 'psd'
      ? textsOf(doc).flatMap((t) => markersIn(t, ''))
      : fromMarkdown(doc.markdown || '');
  const seen = new Set<string>();
  return all
    .filter((q) => {
      if (seen.has(q.id)) return false;
      seen.add(q.id);
      return true;
    })
    .slice(0, 100);
}

/** The question as the AI is given it: its ID, text and where it is. */
export const questionLabel = (q: OpenQuestion) =>
  [
    q.code ? `${q.code}: ${q.text}` : q.text,
    (q.section || q.line) &&
      `(in ${[q.section && `“${q.section}”`, q.line && `the line “${q.line}”`].filter(Boolean).join(', ')})`,
  ]
    .filter(Boolean)
    .join(' ');

/** The questions with an answer typed in, as { question, answer }. */
export function answeredNow(kind: string, doc: any): Answered[] {
  const answers = doc?.answers || {};
  return openQuestions(kind, doc)
    .filter((q) => String(answers[q.id] || '').trim())
    .map((q) => ({ question: questionLabel(q), answer: String(answers[q.id]).trim() }));
}

/** What the team answered so far (now and before), as extra instructions for a rewrite. */
export function answersNote(kind: string, doc: any) {
  const all = [...(doc?.resolved || []), ...answeredNow(kind, doc)];
  if (!all.length) return '';
  return `Answers the team gave to open questions in the previous version (use them; don't mark these points [To confirm] again):\n${all
    .slice(-40)
    .map((a) => `- ${a.question}: ${a.answer}`)
    .join('\n')}`;
}
