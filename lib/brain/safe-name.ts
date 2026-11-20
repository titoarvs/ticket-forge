import crypto from 'node:crypto';

export const NOTE_TYPES = [
  'index',
  'project',
  'context',
  'repo',
  'epic',
  'issue',
  'release',
  'source',
  'doc',
  'decision',
  'question',
  'note',
];
export const FOLDER = {
  index: '',
  project: 'Project',
  context: 'Project',
  repo: 'Project',
  epic: 'Epics',
  issue: 'Issues',
  release: 'Releases',
  source: 'Sources',
  doc: 'Documents',
  decision: 'Decisions',
  question: 'Questions',
  note: 'Notes',
};
export const MAX_BODY = 60000;
export const MAX_USER_NOTES = 3000;
export const clip = (s, n) => {
  const t = String(s ?? '').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
export const sha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');
/** A file name Obsidian (and every OS) accepts: no path or link characters. */
export const safeName = (s) =>
  String(s ?? '')
    .replace(/[\\/:*?"<>|#^[\]\n\r\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 90) || 'Untitled';
const tagOf = (s) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_/-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
export const tagsOf = (list) => [...new Set(list.map(tagOf).filter(Boolean))];
export const base = (id) => String(id).split('/').pop();
/** A wikilink to a note id, with a label when the file name doesn't say enough. */
export const wl = (id, label) =>
  label && label !== base(id)
    ? `[[${base(id)}|${String(label)
        .replace(/[[\]|]/g, ' ')
        .trim()}]]`
    : `[[${base(id)}]]`;
const STOP = new Set(
  'the and for with that this from into when then than your their they them have has had are was were will would should could can not all any each per via its it’s our out off use used using via new add adds added also more most only some such what which while who whom why how about after before over under again been being does doing done issue issues epic story task page user users able want need needs given must make sure'.split(
    ' ',
  ),
);
/** A light English stem, so "retries" matches "retry" and "payments" matches "payment". */
const stem = (w) =>
  w.length > 4
    ? w
        .replace(/ies$/, 'y')
        .replace(/(?<=[^s])s$/, '')
        .replace(/(?<=..)(ing|ed)$/, '')
    : w;
export const words = (s) =>
  (
    String(s || '')
      .toLowerCase()
      .match(/[\p{L}\p{N}]{3,}/gu) || []
  )
    .filter((w) => !STOP.has(w))
    .map(stem);
// ---------------------------------------------------------------- building the notes from the
// project
export const catOf = (p, status) =>
  (p.workflow || []).find((w) => w.name === status)?.category ||
  (/done|closed|resolved/i.test(String(status)) ? 'done' : 'todo');
export const isSub = (t) => t?.type === 'Sub-task' || Boolean(t?.parentId);
/** The issues whose words overlap the text most (for open questions). */
export function related(text, issues, n = 6, min = 2) {
  const want = new Set(words(text));
  if (!want.size) return [];
  return issues
    .map((t) => {
      const have = new Set(words(`${t.title} ${t.userStory || ''}`));
      let s = 0;
      for (const w of want) if (have.has(w)) s += 1;
      return { t, s };
    })
    .filter((x) => x.s >= min)
    .sort(
      (a, b) =>
        b.s - a.s || String(a.t.key).localeCompare(String(b.t.key), undefined, { numeric: true }),
    )
    .slice(0, n)
    .map((x) => x.t);
}
