'use client';
import type { Row, Cell, DiffFile } from '../logic/diff';

export const DIFF_TARGETS: [string, string, string][] = [
  [
    'default',
    'Repository default branch',
    'Everything this job changed compared with the default branch',
  ],
  ['job', 'Previous job run', 'What changed since the last code run for this issue'],
  ['spec', 'Prior spec version', 'What changed since the last run made before the current spec'],
];
export const targetLabel = (t: string) => DIFF_TARGETS.find((x) => x[0] === t)?.[1] || t;
export const VIEW_KEY = 'tf.diff.view';
export const NARROW = 760;
// below this width the panel shows one column and a file menu
export const fmt = (n: number) => n.toLocaleString();
export const split = (path: string) => {
  const i = path.lastIndexOf('/');
  return i < 0 ? ['', path] : [path.slice(0, i + 1), path.slice(i + 1)];
};
export const LETTER: Record<string, string> = { added: 'A', deleted: 'D', modified: 'M' };
/** A small five-block bar of how much of a file was added vs removed, like GitHub's. */
export function Bar({ a, d }: { a: number; d: number }) {
  const t = a + d || 1,
    green = Math.round((a / t) * 5);
  return (
    <span className="dv-bar5" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} className={a + d === 0 ? '' : i < green ? 'a' : 'd'} />
      ))}
    </span>
  );
}
type ULine =
  | { kind: 'hunk'; text: string }
  | { kind: 'line'; o: number | null; n: number | null; text: string; t: 'ctx' | 'add' | 'del' };
/**
 * Side-by-side rows as unified lines: unchanged lines once, and in each changed block the removed
 * lines before the added ones.
 */
function unified(rows: Row[]): ULine[] {
  const out: ULine[] = [];
  let dels: Cell[] = [],
    adds: Cell[] = [];
  const flush = () => {
    for (const c of dels) out.push({ kind: 'line', o: c.no, n: null, text: c.text, t: 'del' });
    for (const c of adds) out.push({ kind: 'line', o: null, n: c.no, text: c.text, t: 'add' });
    dels = [];
    adds = [];
  };
  for (const r of rows) {
    if (r.kind === 'hunk') {
      flush();
      out.push(r);
      continue;
    }
    if (r.ctx) {
      flush();
      out.push({
        kind: 'line',
        o: r.l?.no ?? null,
        n: r.r?.no ?? null,
        text: r.r?.text ?? r.l?.text ?? '',
        t: 'ctx',
      });
      continue;
    }
    if (r.l) dels.push(r.l);
    if (r.r) adds.push(r.r);
  }
  flush();
  return out;
}
/** "@@ -10,4 +10,7 @@ function name" → "Lines 10–16 · function name" */
const hunkLabel = (text: string) => {
  const m = text.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/);
  if (!m) return text;
  // The new file's lines, or the old file's when the file was deleted (nothing is left on the new
  // side).
  const newN = m[4] === undefined ? 1 : Number(m[4]);
  const from = Number(newN ? m[3] : m[1]),
    n = newN || (m[2] === undefined ? 1 : Number(m[2]));
  return `${n > 1 ? `Lines ${from}–${from + n - 1}` : `Line ${from}`}${m[5] ? ` · ${m[5].trim()}` : ''}`;
};
export function FileBody({ f, view }: { f: DiffFile; view: 'split' | 'unified' }) {
  if (f.binary) return <p className="muted small dv-note">Binary file: not shown.</p>;
  if (!f.rows.length)
    return (
      <p className="muted small dv-note">
        {f.status === 'added' ? 'Empty file added.' : 'No line changes (only its mode or name).'}
      </p>
    );
  if (view === 'unified') {
    return (
      <table className="dv-tbl dv-uni" aria-label={`Changes in ${f.path}`}>
        <colgroup>
          <col className="dv-c-no" />
          <col className="dv-c-no" />
          <col />
        </colgroup>
        <tbody>
          {unified(f.rows).map((r, i) =>
            r.kind === 'hunk' ? (
              <tr key={i} className="dv-hunk">
                <td colSpan={3}>
                  <span>{hunkLabel(r.text)}</span>
                </td>
              </tr>
            ) : (
              <tr key={i} className={r.t}>
                <td className="dv-no">{r.o ?? ''}</td>
                <td className="dv-no">{r.n ?? ''}</td>
                <td className="dv-code">
                  <span className="dv-sign" aria-hidden>
                    {r.t === 'add' ? '+' : r.t === 'del' ? '−' : ''}
                  </span>
                  {r.text}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    );
  }
  return (
    <table className="dv-tbl dv-split" aria-label={`Changes in ${f.path}`}>
      <colgroup>
        <col className="dv-c-no" />
        <col />
        <col className="dv-c-no" />
        <col />
      </colgroup>
      <tbody>
        {f.rows.map((r: Row, i) =>
          r.kind === 'hunk' ? (
            <tr key={i} className="dv-hunk">
              <td colSpan={4}>
                <span>{hunkLabel(r.text)}</span>
              </td>
            </tr>
          ) : (
            <tr key={i} className={r.ctx ? 'ctx' : ''}>
              <td className={`dv-no ${r.l && !r.ctx ? 'del' : ''} ${r.l ? '' : 'empty'}`}>
                {r.l?.no ?? ''}
              </td>
              <td className={`dv-code left ${r.l ? (r.ctx ? '' : 'del') : 'empty'}`}>
                {r.l ? (
                  <>
                    <span className="dv-sign" aria-hidden>
                      {r.ctx ? '' : '−'}
                    </span>
                    {r.l.text}
                  </>
                ) : null}
              </td>
              <td className={`dv-no ${r.r && !r.ctx ? 'add' : ''} ${r.r ? '' : 'empty'}`}>
                {r.r?.no ?? ''}
              </td>
              <td className={`dv-code ${r.r ? (r.ctx ? '' : 'add') : 'empty'}`}>
                {r.r ? (
                  <>
                    <span className="dv-sign" aria-hidden>
                      {r.ctx ? '' : '+'}
                    </span>
                    {r.r.text}
                  </>
                ) : null}
              </td>
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}
