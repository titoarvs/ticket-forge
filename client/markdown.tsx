// A small, safe Markdown renderer with no hooks, so it works in server components (the public legal pages) as well as
// in the app. Supports headings (with anchor ids), paragraphs, lists, tables, quotes, **bold**, *italic*, `code` and
// links to this site (/…), https:// pages and mailto:. Anything else renders as plain text: no raw HTML.
import type { ReactNode } from 'react';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const safeHref = (u: string) => (/^(\/(?!\/)|#|https:\/\/|mailto:)/i.test(u) ? u : null);

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0, m: RegExpExecArray | null, n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}i${n++}`;
    if (m[2]) out.push(<strong key={k}>{m[2]}</strong>);
    else if (m[3]) out.push(<em key={k}>{m[3]}</em>);
    else if (m[4]) out.push(<code key={k}>{m[4]}</code>);
    else if (m[5]) { const href = safeHref(m[6]); out.push(href ? <a key={k} href={href} {...(/^https:/i.test(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{m[5]}</a> : m[5]); }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** `baseLevel`: the HTML level of a Markdown "#" heading (2 makes "## A" an <h3>). */
export function MarkdownDoc({ text, baseLevel = 1 }: { text: string; baseLevel?: number }) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    const k = `b${i}`;
    if (!l.trim()) { i++; continue; }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = Math.min(6, h[1].length + baseLevel - 1);
      const H = `h${level}` as 'h2';
      blocks.push(<H key={k} id={slug(h[2])}>{inline(h[2], k)}</H>);
      i++; continue;
    }
    if (/^\s*>/.test(l)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote key={k}>{inline(q.join(' '), k)}</blockquote>);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().slice(1, -1).split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      blocks.push(<div key={k} className="md-table-wrap"><table><thead><tr>{rows[0]?.map((c, j) => <th key={j}>{inline(c, `${k}h${j}`)}</th>)}</tr></thead>
        <tbody>{rows.slice(1).map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `${k}${ri}${j}`)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d+[.)]\s+/.test(l);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
      const L = ordered ? 'ol' : 'ul';
      blocks.push(<L key={k}>{items.map((it, j) => <li key={j}>{inline(it, `${k}l${j}`)}</li>)}</L>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*>|\s*\||\s*([-*+]|\d+[.)])\s)/.test(lines[i])) para.push(lines[i++].trim());
    blocks.push(<p key={k}>{inline(para.join(' '), k)}</p>);
  }
  return <>{blocks}</>;
}

/** The ## headings of a document, for a table of contents. */
export const headingsOf = (text: string) => [...String(text || '').matchAll(/^##\s+(.+)$/gm)].map((m) => ({ id: slug(m[1]), title: m[1].replace(/\*\*/g, '') }));
