// Markdown (as written for agent documents) to a Word document: headings, paragraphs with bold,
// italic, code and links, bulleted and numbered lists, and tables with a navy header row.
const NAVY = '0C2A50';

/** Inline Markdown → runs. */
function inline(d, text, base: any = {}) {
  const { TextRun, ExternalHyperlink } = d;
  const out: any[] = [];
  const re =
    /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0,
    m;
  const plain = (s) => s && out.push(new TextRun({ text: s, ...base }));
  while ((m = re.exec(text))) {
    plain(text.slice(last, m.index));
    if (m[2] || m[3]) out.push(new TextRun({ text: m[2] || m[3], bold: true, ...base }));
    else if (m[4] || m[5]) out.push(new TextRun({ text: m[4] || m[5], italics: true, ...base }));
    else if (m[6]) out.push(new TextRun({ text: m[6], font: 'Consolas', ...base }));
    else if (m[7]) {
      const url = m[8];
      out.push(
        /^(https?:|mailto:)/i.test(url)
          ? new ExternalHyperlink({
              link: url,
              children: [new TextRun({ text: m[7], style: 'Hyperlink', ...base })],
            })
          : new TextRun({ text: m[7], ...base }),
      );
    }
    last = re.lastIndex;
  }
  plain(text.slice(last));
  return out;
}
const cellsOf = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));

export async function markdownToDocx(
  md,
  { title = 'Document', creator = 'TicketForge' }: any = {},
) {
  const d = await import('docx');
  const {
    Document,
    Packer,
    Paragraph,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    WidthType,
    ShadingType,
    AlignmentType,
    LevelFormat,
    TextRun,
  } = d;
  const lines = String(md || '')
    .replace(/\r\n/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n');
  const kids: any[] = [];
  let numbered = 0; // a new numbering instance for each numbered list
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) {
      i++;
      continue;
    }
    let m;
    if ((m = l.match(/^#\s+(.*)/))) {
      kids.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          spacing: { after: 240 },
          children: inline(d, m[1], { size: 44, color: NAVY }),
        }),
      );
      i++;
      continue;
    }
    if ((m = l.match(/^##\s+(.*)/))) {
      kids.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 280, after: 120 },
          children: inline(d, m[1], { color: NAVY }),
        }),
      );
      i++;
      continue;
    }
    if ((m = l.match(/^#{3,6}\s+(.*)/))) {
      kids.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 180, after: 80 },
          children: inline(d, m[1], { color: NAVY }),
        }),
      );
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      const rows: any[] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        if (!/^\s*\|?\s*:?-{2,}/.test(lines[i])) rows.push(cellsOf(lines[i]));
        i++;
      }
      const cols = Math.max(...rows.map((r) => r.length));
      kids.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: rows.map(
            (r, ri) =>
              new TableRow({
                tableHeader: ri === 0,
                children: Array.from(
                  { length: cols },
                  (_, ci) =>
                    new TableCell({
                      ...(ri === 0
                        ? { shading: { type: ShadingType.CLEAR, fill: NAVY, color: 'auto' } }
                        : {}),
                      margins: { top: 60, bottom: 60, left: 100, right: 100 },
                      children: [
                        new Paragraph({
                          children: inline(
                            d,
                            r[ci] ?? '',
                            ri === 0 ? { bold: true, color: 'FFFFFF', size: 19 } : { size: 19 },
                          ),
                        }),
                      ],
                    }),
                ),
              }),
          ),
        }),
      );
      kids.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
      continue;
    }
    if (/^\s*[-*+]\s+/.test(l)) {
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        kids.push(
          new Paragraph({
            bullet: { level: /^\s{2,}/.test(lines[i]) ? 1 : 0 },
            spacing: { after: 60 },
            children: inline(d, lines[i].replace(/^\s*[-*+]\s+/, '')),
          }),
        );
        i++;
      }
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(l)) {
      const ref = `num${numbered++}`;
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        kids.push(
          new Paragraph({
            numbering: { reference: 'ordered', level: 0, instance: numbered },
            spacing: { after: 60 },
            children: inline(d, lines[i].replace(/^\s*\d+[.)]\s+/, '')),
          }),
        );
        i++;
      }
      void ref;
      continue;
    }
    if (/^\s*>\s?/.test(l)) {
      const q: any[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i]))
        q.push(lines[i++].replace(/^\s*>\s?/, ''));
      kids.push(
        new Paragraph({
          indent: { left: 360 },
          border: { left: { style: 'single', size: 12, color: NAVY, space: 8 } },
          children: inline(d, q.join(' '), { italics: true }),
        }),
      );
      continue;
    }
    const para = [l.trim()];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#|\s*\||\s*[-*+]\s|\s*\d+[.)]\s|\s*>)/.test(lines[i])
    )
      para.push(lines[i++].trim());
    kids.push(new Paragraph({ spacing: { after: 120 }, children: inline(d, para.join(' ')) }));
  }
  const doc = new Document({
    creator,
    title,
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    numbering: {
      config: [
        {
          reference: 'ordered',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 540, hanging: 300 } } },
            },
          ],
        },
      ],
    },
    sections: [{ children: kids.length ? kids : [new Paragraph({ children: [new TextRun('')] })] }],
  });
  return Packer.toBuffer(doc);
}
