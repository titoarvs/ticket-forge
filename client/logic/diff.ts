// Diff view logic (TF-121): turns a unified diff (git's output) into files of side-by-side rows. No UI, no requests.

export type Cell = { no: number; text: string };
/** One row of a side-by-side diff: the old line on the left, the new one on the right (either can be empty). `ctx` rows are unchanged lines. */
export type Row = { kind: 'hunk'; text: string } | { kind: 'line'; l: Cell | null; r: Cell | null; ctx: boolean };
export type DiffFile = { path: string; status: 'added' | 'deleted' | 'modified'; added: number; removed: number; binary: boolean; rows: Row[] };

/** Parses a unified diff into files. Lines such as `--- x` inside a hunk are code; the hunk header's counts tell where a hunk ends. */
export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let f: DiffFile | null = null;
  let oldNo = 0, newNo = 0, oldLeft = 0, newLeft = 0;
  let dels: Cell[] = [], adds: Cell[] = [];
  const flush = () => {
    if (!f) return;
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) f.rows.push({ kind: 'line', l: dels[i] || null, r: adds[i] || null, ctx: false });
    dels = []; adds = [];
  };
  for (const line of String(text || '').split('\n')) {
    if (f && (oldLeft > 0 || newLeft > 0) && line[0] !== '\\') {
      const ch = line[0], body = line.slice(1);
      if (ch === '-') { dels.push({ no: oldNo++, text: body }); oldLeft--; f.removed++; continue; }
      if (ch === '+') { adds.push({ no: newNo++, text: body }); newLeft--; f.added++; continue; }
      flush();
      f.rows.push({ kind: 'line', l: { no: oldNo++, text: body }, r: { no: newNo++, text: body }, ctx: true }); oldLeft--; newLeft--;
      continue;
    }
    if (line.startsWith('diff --git ')) { flush(); f = { path: (line.match(/ b\/(.+)$/) || [])[1] || '', status: 'modified', added: 0, removed: 0, binary: false, rows: [] }; files.push(f); continue; }
    if (!f) continue;
    const h = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (h) {
      flush();
      oldNo = Number(h[1]) || 1; newNo = Number(h[3]) || 1;
      oldLeft = h[2] === undefined ? 1 : Number(h[2]); newLeft = h[4] === undefined ? 1 : Number(h[4]);
      f.rows.push({ kind: 'hunk', text: line });
    } else if (line.startsWith('--- /dev/null') || line.startsWith('new file mode')) f.status = 'added';
    else if (line.startsWith('+++ /dev/null') || line.startsWith('deleted file mode')) f.status = 'deleted';
    else if (line.startsWith('+++ b/')) f.path = line.slice(6);
    else if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) f.binary = true;
  }
  flush();
  return files;
}
