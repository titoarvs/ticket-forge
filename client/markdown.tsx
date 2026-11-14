// A small, safe Markdown renderer with no hooks, so it works in server components (the public legal pages) as well as
// in the app. Supports headings (with anchor ids), paragraphs, lists, tables, quotes, **bold**, *italic*, `code` and
// links to this site (/…), https:// pages and mailto:, fenced code blocks, and Obsidian [[wikilinks]] (rendered by the
// `wikilink` callback when given, else as plain text). Anything else renders as plain text: no raw HTML.
import type { ReactNode } from 'react';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const safeHref = (u: string) => (/^(\/(?!\/)|#|https:\/\/|mailto:)/i.test(u) ? u : null);

/** Table cells: split on | outside [[wikilinks]] (whose alias uses |) and not escaped as \|. */
function cellsOf(row: string) {
  const out: string[] = [];
  let cur = '', depth = 0;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (c === '\\' && row[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '[' && row[i + 1] === '[') { depth++; cur += '[['; i++; continue; }
    if (c === ']' && row[i + 1] === ']' && depth) { depth--; cur += ']]'; i++; continue; }
    if (c === '|' && !depth) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}
export type WikiLink = (target: string, label: string, key: string) => ReactNode;
type Opts = { wikilink?: WikiLink };

function inline(text: string, key: string, o: Opts = {}): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(!?\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0, m: RegExpExecArray | null, n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}i${n++}`;
    if (m[2]) { const target = m[2].trim(), label = (m[3] || '').trim() || target; out.push(o.wikilink ? o.wikilink(target, label, k) : <span key={k} className="wikilink">{label}</span>); }
    else if (m[4]) out.push(<strong key={k}>{m[4]}</strong>);
    else if (m[5]) out.push(<em key={k}>{m[5]}</em>);
    else if (m[6]) out.push(<code key={k}>{m[6]}</code>);
    else if (m[7]) { const href = safeHref(m[8]); out.push(href ? <a key={k} href={href} {...(/^https:/i.test(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{m[7]}</a> : m[7]); }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** `baseLevel`: the HTML level of a Markdown "#" heading (2 makes "## A" an <h3>). */
export function MarkdownDoc({ text, baseLevel = 1, wikilink }: { text: string; baseLevel?: number; wikilink?: WikiLink }) {
  const o: Opts = { wikilink };
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    const k = `b${i}`;
    if (!l.trim()) { i++; continue; }
    const fence = l.match(/^\s*(```|~~~)/);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={k} className="md-pre"><code>{code.join('\n')}</code></pre>);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) { blocks.push(<hr key={k} />); i++; continue; }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = Math.min(6, h[1].length + baseLevel - 1);
      const H = `h${level}` as 'h2';
      blocks.push(<H key={k} id={slug(h[2])}>{inline(h[2], k, o)}</H>);
      i++; continue;
    }
    if (/^\s*>/.test(l)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote key={k}>{inline(q.join(' '), k, o)}</blockquote>);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = cellsOf(lines[i].trim().slice(1, -1));
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      blocks.push(<div key={k} className="md-table-wrap"><table><thead><tr>{rows[0]?.map((c, j) => <th key={j}>{inline(c, `${k}h${j}`, o)}</th>)}</tr></thead>
        <tbody>{rows.slice(1).map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `${k}${ri}${j}`, o)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d+[.)]\s+/.test(l);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
      const L = ordered ? 'ol' : 'ul';
      blocks.push(<L key={k}>{items.map((it, j) => <li key={j}>{inline(it, `${k}l${j}`, o)}</li>)}</L>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*>|\s*\||\s*([-*+]|\d+[.)])\s|\s*(```|~~~))/.test(lines[i])) para.push(lines[i++].trim());
    blocks.push(<p key={k}>{inline(para.join(' '), k, o)}</p>);
  }
  return <>{blocks}</>;
}

/** The ## headings of a document, for a table of contents. */
export const headingsOf = (text: string) => [...String(text || '').matchAll(/^##\s+(.+)$/gm)].map((m) => ({ id: slug(m[1]), title: m[1].replace(/\*\*/g, '') }));
