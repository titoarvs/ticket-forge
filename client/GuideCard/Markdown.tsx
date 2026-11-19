'use client';
import type { ReactNode } from 'react';
import type { Any } from '../core';

export const GUIDE_TEMPLATE = `# Generation guide

## Product
One or two sentences: what the product is and who uses it.

## Glossary
- **Order**: a customer's purchase, with one or more items.
- **Customer** (not "user"): a person buying from the store.

## Roles
- **Admin**: manages products, prices and refunds.
- **Cashier**: takes orders; can't change settings.

## Ticket conventions
- Title: verb + object, e.g. "Export orders to CSV".
- Labels: frontend, backend, api, db.
- Mention the screen or API endpoint in the description.

## Example ticket
**Title:** Export orders to CSV
**User story:** As a store manager, I want to export orders to CSV, so that I can share them with accounting.
**Acceptance criteria:**
1. Given orders in the selected date range, when I click Export CSV, then a CSV with one row per order downloads.
2. Given no orders in the range, when I click Export CSV, then I see "No orders to export" and nothing downloads.
3. Given I'm a cashier, when I open Orders, then I don't see Export CSV.

## Test case conventions
- Use the product "Test Mug" and the customer "QA Customer".
- Expected results describe what's on screen, not what happens in the database.

## Example test case
**Title:** Verify a manager can export orders to CSV
**Preconditions:** Signed in as Admin; at least one order this week.
**Steps:**
1. Open Orders.
2. Choose "This week".
3. Click Export CSV.
**Expected:** A file orders.csv downloads with one row per order.

## Don'ts
- Don't add tickets for analytics, notifications or mobile unless the document asks for them.
`;
// ---------------------------------------------------------------- a small, safe Markdown preview
// (no HTML injection)
function inline(text: string, key = ''): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0,
    m: RegExpExecArray | null,
    n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0],
      k = `${key}-${n++}`;
    if (t.startsWith('**')) out.push(<b key={k}>{t.slice(2, -2)}</b>);
    else if (t.startsWith('`')) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('[')) {
      const lm = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      out.push(
        lm && /^https?:\/\//.test(lm[2]) ? (
          <a key={k} href={lm[2]} target="_blank" rel="noopener noreferrer">
            {lm[1]}
          </a>
        ) : (
          t
        ),
      );
    } else out.push(<i key={k}>{t.slice(1, -1)}</i>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    const k = `b${i}`;
    if (!l.trim()) {
      i++;
      continue;
    }
    if (l.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={k} className="code">
          {code.join('\n')}
        </pre>,
      );
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const H = `h${Math.min(6, h[1].length + 2)}` as Any;
      blocks.push(<H key={k}>{inline(h[2], k)}</H>);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(l)) {
      blocks.push(<hr key={k} />);
      i++;
      continue;
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
        const cells = lines[i]
          .trim()
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      blocks.push(
        <table key={k} className="tbl md-tbl">
          <thead>
            <tr>
              {rows[0]?.map((c, j) => (
                <th key={j}>{inline(c, `${k}h${j}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(1).map((r, ri) => (
              <tr key={ri}>
                {r.map((c, j) => (
                  <td key={j}>{inline(c, `${k}${ri}${j}`)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d+[.)]\s+/.test(l);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]))
        items.push(lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
      const L = ordered ? 'ol' : 'ul';
      blocks.push(
        <L key={k}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, `${k}${j}`)}</li>
          ))}
        </L>,
      );
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4}\s|```|\s*>|\s*\||\s*([-*+]|\d+[.)])\s+)/.test(lines[i])
    )
      para.push(lines[i++]);
    blocks.push(
      <p key={k}>
        {para.flatMap((x, j) =>
          j ? [<br key={`br${j}`} />, ...inline(x, `${k}${j}`)] : inline(x, `${k}${j}`),
        )}
      </p>,
    );
  }
  return <div className="md">{blocks}</div>;
}
