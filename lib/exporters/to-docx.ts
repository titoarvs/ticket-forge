import {
  Paragraph,
  TextRun,
  TableCell,
  ShadingType,
  WidthType,
  HeadingLevel,
  PageBreak,
  Table,
  TableRow,
  Document,
  Footer,
  AlignmentType,
  PageNumber,
  Packer,
} from 'docx';
import { groups, stepsText } from './to-csv-jira';

// ---------- Word ----------
export async function toDocx(p) {
  const kids: any[] = [];
  const H = (text, heading) =>
    new Paragraph({ text, heading, spacing: { before: 240, after: 120 } });
  const P = (text, opts: any = {}) =>
    new Paragraph({
      children: [new TextRun({ text: String(text ?? ''), ...opts })],
      spacing: { after: 80 },
    });
  const label = (l, v) =>
    new Paragraph({
      children: [new TextRun({ text: `${l}: `, bold: true }), new TextRun(String(v ?? ''))],
      spacing: { after: 60 },
    });
  const bullets = (items) =>
    items.map((x) => new Paragraph({ text: x, bullet: { level: 0 }, spacing: { after: 40 } }));
  const multiline = (text) =>
    String(text || '')
      .split('\n')
      .map((l) => P(l));
  const cell = (text, opts: any = {}) =>
    new TableCell({
      children: String(text ?? '')
        .split('\n')
        .map(
          (l) =>
            new Paragraph({
              children: [new TextRun({ text: l, bold: opts.bold, color: opts.color, size: 18 })],
            }),
        ),
      shading: opts.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.fill } : undefined,
      width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
    });

  kids.push(new Paragraph({ text: p.name, heading: HeadingLevel.TITLE }));
  kids.push(
    P(
      `Backlog, acceptance criteria and test plan · ${p.key} · ${new Date().toLocaleDateString()}`,
      { color: '666666' },
    ),
  );
  if (p.sourceName) kids.push(label('Source document', p.sourceName));
  kids.push(
    label(
      'Totals',
      `${p.epics.length} epics · ${p.tickets.length} tickets · ${p.tickets.reduce((s, t) => s + (t.storyPoints || 0), 0)} story points · ${p.tickets.reduce((s, t) => s + t.testCases.length, 0)} test cases`,
    ),
  );
  if (p.description) {
    kids.push(H('Description', HeadingLevel.HEADING_1));
    kids.push(...multiline(p.description));
  }
  if (p.summary) {
    kids.push(H('Summary', HeadingLevel.HEADING_1));
    kids.push(...multiline(p.summary));
  }
  if (p.assumptions?.length) {
    kids.push(H('Assumptions', HeadingLevel.HEADING_2));
    kids.push(...bullets(p.assumptions));
  }
  if (p.openQuestions?.length) {
    kids.push(H('Open questions', HeadingLevel.HEADING_2));
    kids.push(...bullets(p.openQuestions));
  }

  for (const { epic, tickets } of groups(p)) {
    kids.push(new Paragraph({ children: [new PageBreak()] }));
    kids.push(H(`${epic.key} · ${epic.title}`, HeadingLevel.HEADING_1));
    if (epic.description) kids.push(...multiline(epic.description));
    for (const t of tickets) {
      kids.push(H(`${t.key} · ${t.title}`, HeadingLevel.HEADING_2));
      kids.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: ['Type', 'Priority', 'Story points', 'Status', 'Assignee'].map((h) =>
                cell(h, { bold: true, fill: 'EEF2FF', width: 20 }),
              ),
            }),
            new TableRow({
              children: [
                t.type,
                t.priority,
                t.storyPoints ?? '—',
                t.status,
                t.assignee || 'Unassigned',
              ].map((v) => cell(v, { width: 20 })),
            }),
          ],
        }),
      );
      if (t.labels.length) kids.push(label('Labels', t.labels.join(', ')));
      if (t.userStory) {
        kids.push(H('User story', HeadingLevel.HEADING_3));
        kids.push(P(t.userStory, { italics: true }));
      }
      if (t.description) {
        kids.push(H('Description', HeadingLevel.HEADING_3));
        kids.push(...multiline(t.description));
      }
      if (t.acceptanceCriteria.length) {
        kids.push(H('Acceptance criteria', HeadingLevel.HEADING_3));
        t.acceptanceCriteria.forEach((a, i) =>
          kids.push(
            new Paragraph({
              children: [new TextRun({ text: `AC${i + 1}  `, bold: true }), new TextRun(a)],
              spacing: { after: 60 },
            }),
          ),
        );
      }
      if (t.dependencies.length) {
        kids.push(H('Dependencies', HeadingLevel.HEADING_3));
        kids.push(...bullets(t.dependencies));
      }
      if (t.testCases.length) {
        kids.push(H('Test cases', HeadingLevel.HEADING_3));
        kids.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                tableHeader: true,
                children: ['ID', 'Test', 'Steps', 'Expected'].map((h, i) =>
                  cell(h, {
                    bold: true,
                    color: 'FFFFFF',
                    fill: '4F46E5',
                    width: [14, 26, 34, 26][i],
                  }),
                ),
              }),
              ...t.testCases.map(
                (tc) =>
                  new TableRow({
                    children: [
                      cell(`${tc.key}\n${tc.type} · ${tc.priority}`, { width: 14 }),
                      cell(`${tc.title}${tc.preconditions ? `\nPre: ${tc.preconditions}` : ''}`, {
                        width: 26,
                      }),
                      cell(stepsText(tc), { width: 34 }),
                      cell(tc.expected, { width: 26 }),
                    ],
                  }),
              ),
            ],
          }),
        );
      }
    }
  }

  const doc = new Document({
    creator: 'TicketForge',
    title: p.name,
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    sections: [
      {
        children: kids,
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    children: [`${p.name} · page `, PageNumber.CURRENT],
                    size: 16,
                    color: '888888',
                  }),
                ],
              }),
            ],
          }),
        },
      },
    ],
  });
  return Packer.toBuffer(doc);
}
