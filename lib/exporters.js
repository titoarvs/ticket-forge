import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, ShadingType, AlignmentType, PageBreak, Footer, PageNumber,
} from 'docx';

// ---------- helpers ----------
const epicOf = (p, t) => p.epics.find((e) => e.id === t.epicId);
const ticketsOf = (p, e) => p.tickets.filter((t) => t.epicId === e.id);
const unassigned = (p) => p.tickets.filter((t) => !p.epics.some((e) => e.id === t.epicId));
function groups(p) {
  const g = p.epics.map((e) => ({ epic: e, tickets: ticketsOf(p, e) }));
  const u = unassigned(p);
  if (u.length) g.push({ epic: { key: '—', title: 'Unassigned', description: '' }, tickets: u });
  return g;
}
const sprintOf = (p, t) => (p.sprints || []).find((s) => s.id === t.sprintId)?.name || '';
const keyOf = (p, id) => p.tickets.find((x) => x.id === id)?.key || '';
const linksText = (p, t) => (t.links || []).map((l) => `${l.type} ${keyOf(p, l.targetId)}`).join('; ');
const prsText = (t) => (t.prs || []).map((r) => `${r.url} (${r.status})`).join('\n');
const lastRun = (tc) => (tc.lastRun ? `${tc.lastRun.status} ${new Date(tc.lastRun.at).toLocaleString()}` : '');
const numbered = (list) => list.map((x, i) => `${i + 1}. ${x}`).join('\n');
const stepsText = (tc) => numbered(tc.steps || []);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const slug = (s) => String(s || 'project').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'project';

// ---------- CSV ----------
function csv(rows) {
  const cell = (v) => {
    const s = Array.isArray(v) ? v.join('\n') : String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

export function toCsvTickets(p) {
  const rows = [['Epic Key', 'Epic', 'Ticket Key', 'Title', 'Type', 'Priority', 'Story Points', 'Status', 'Assignee', 'Reporter', 'Sprint', 'Parent', 'Labels', 'User Story', 'Description', 'Acceptance Criteria', 'Dependencies', 'Linked Issues', 'Pull Requests', 'Comments', 'Test Case Count']];
  for (const { epic, tickets } of groups(p)) for (const t of tickets) {
    rows.push([epic.key, epic.title, t.key, t.title, t.type, t.priority, t.storyPoints ?? '', t.status, t.assignee || '', t.reporter || '', sprintOf(p, t), keyOf(p, t.parentId), t.labels.join(', '), t.userStory, t.description, numbered(t.acceptanceCriteria), t.dependencies.join('; '), linksText(p, t), prsText(t), (t.comments || []).length, t.testCases.length]);
  }
  return csv(rows);
}

export function toCsvTestCases(p) {
  const rows = [['Test Case Key', 'Ticket Key', 'Ticket', 'Epic', 'Title', 'Type', 'Priority', 'Preconditions', 'Steps', 'Expected Result', 'Covers AC', 'Status', 'Automated', 'Last Automated Run', 'Last Run Error']];
  for (const t of p.tickets) for (const tc of t.testCases) {
    rows.push([tc.key, t.key, t.title, epicOf(p, t)?.title || '', tc.title, tc.type, tc.priority, tc.preconditions, stepsText(tc), tc.expected, (tc.acRef || []).map((n) => `AC${n}`).join(', '), tc.status, tc.script ? 'Yes' : 'No', lastRun(tc), tc.lastRun?.error || '']);
  }
  return csv(rows);
}

/** Jira Cloud CSV import: epics, issues and sub-tasks linked with Issue Id / Parent. */
export function toCsvJira(p) {
  const rows = [['Issue Id', 'Parent', 'Issue Type', 'Summary', 'Description', 'Priority', 'Story Points', 'Labels', 'Epic Name', 'Sprint', 'Assignee', 'Status']];
  const ids = new Map();
  let n = 0;
  p.epics.forEach((e) => { n += 1; ids.set(e.id, String(n)); });
  p.tickets.forEach((t) => { n += 1; ids.set(t.id, String(n)); });
  p.epics.forEach((e) => rows.push([ids.get(e.id), '', 'Epic', e.title, e.description, '', '', '', e.title, '', '', '']));
  for (const t of p.tickets) {
    const desc = [
      t.userStory && `*User story*\n${t.userStory}`,
      t.description && `*Description*\n${t.description}`,
      t.acceptanceCriteria.length && `*Acceptance criteria*\n${t.acceptanceCriteria.map((a) => `# ${a}`).join('\n')}`,
      t.testCases.length && `*Test cases*\n${t.testCases.map((tc) => `* ${tc.key} ${tc.title} — expected: ${tc.expected}`).join('\n')}`,
      (t.prs || []).length && `*Pull requests*\n${t.prs.map((r) => `* ${r.url} (${r.status})`).join('\n')}`,
    ].filter(Boolean).join('\n\n');
    const parent = t.parentId ? ids.get(t.parentId) : ids.get(t.epicId);
    const type = t.type === 'Sub-task' ? 'Sub-task' : t.type === 'Spike' ? 'Task' : t.type;
    rows.push([ids.get(t.id), parent || '', type, t.title, desc, t.priority, t.storyPoints ?? '', t.labels.map((l) => l.replace(/\s+/g, '-')).join(' '), '', sprintOf(p, t), t.assignee || '', t.status]);
  }
  return csv(rows);
}

// ---------- Excel ----------
export async function toXlsx(p) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TicketForge';
  wb.created = new Date();
  const header = (ws) => {
    const row = ws.getRow(1);
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    row.alignment = { vertical: 'middle' };
    row.height = 22;
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
    ws.eachRow((r, i) => { if (i > 1) r.alignment = { wrapText: true, vertical: 'top' }; });
  };

  const ov = wb.addWorksheet('Overview');
  ov.columns = [{ width: 22 }, { width: 100 }];
  const ovRows = [
    ['Project', p.name], ['Key', p.key], ['Source document', p.sourceName], ['Summary', p.summary],
    ['Epics', p.epics.length], ['Tickets', p.tickets.length],
    ['Story points', p.tickets.reduce((s, t) => s + (t.storyPoints || 0), 0)],
    ['Test cases', p.tickets.reduce((s, t) => s + t.testCases.length, 0)],
    ['Assumptions', numbered(p.assumptions || [])], ['Open questions', numbered(p.openQuestions || [])],
    ['Exported', new Date().toLocaleString()],
  ];
  ovRows.forEach((r) => { const row = ov.addRow(r); row.getCell(1).font = { bold: true }; row.alignment = { wrapText: true, vertical: 'top' }; });
  ov.getRow(1).getCell(2).font = { bold: true, size: 14 };

  const ep = wb.addWorksheet('Epics');
  ep.columns = [
    { header: 'Epic Key', key: 'key', width: 12 }, { header: 'Epic', key: 'title', width: 34 }, { header: 'Description', key: 'description', width: 70 },
    { header: 'Tickets', key: 'count', width: 10 }, { header: 'Story Points', key: 'sp', width: 13 }, { header: 'Test Cases', key: 'tc', width: 12 },
  ];
  for (const e of p.epics) {
    const ts = ticketsOf(p, e);
    ep.addRow({ key: e.key, title: e.title, description: e.description, count: ts.length, sp: ts.reduce((s, t) => s + (t.storyPoints || 0), 0), tc: ts.reduce((s, t) => s + t.testCases.length, 0) });
  }
  header(ep);

  const tk = wb.addWorksheet('Tickets');
  tk.columns = [
    { header: 'Key', key: 'key', width: 11 }, { header: 'Epic', key: 'epic', width: 26 }, { header: 'Title', key: 'title', width: 40 },
    { header: 'Type', key: 'type', width: 9 }, { header: 'Priority', key: 'priority', width: 10 }, { header: 'SP', key: 'sp', width: 6 },
    { header: 'Status', key: 'status', width: 11 }, { header: 'Assignee', key: 'assignee', width: 16 }, { header: 'Sprint', key: 'sprint', width: 16 }, { header: 'Parent', key: 'parent', width: 10 }, { header: 'Labels', key: 'labels', width: 16 }, { header: 'User Story', key: 'story', width: 50 },
    { header: 'Description', key: 'description', width: 60 }, { header: 'Acceptance Criteria', key: 'ac', width: 80 },
    { header: 'Dependencies', key: 'deps', width: 30 }, { header: 'Linked Issues', key: 'links', width: 28 }, { header: 'Pull Requests', key: 'prs', width: 40 }, { header: 'Test Cases', key: 'tc', width: 10 },
  ];
  for (const { epic, tickets } of groups(p)) for (const t of tickets) {
    tk.addRow({ key: t.key, epic: epic.title, title: t.title, type: t.type, priority: t.priority, sp: t.storyPoints ?? '', status: t.status, assignee: t.assignee || '', sprint: sprintOf(p, t), parent: keyOf(p, t.parentId), links: linksText(p, t), prs: prsText(t), labels: t.labels.join(', '), story: t.userStory, description: t.description, ac: numbered(t.acceptanceCriteria), deps: t.dependencies.join('\n'), tc: t.testCases.length });
  }
  header(tk);

  const tcs = wb.addWorksheet('Test Cases');
  tcs.columns = [
    { header: 'Test Case', key: 'key', width: 16 }, { header: 'Ticket', key: 'ticket', width: 11 }, { header: 'Ticket Title', key: 'ttitle', width: 32 },
    { header: 'Title', key: 'title', width: 40 }, { header: 'Type', key: 'type', width: 13 }, { header: 'Priority', key: 'priority', width: 10 },
    { header: 'Preconditions', key: 'pre', width: 36 }, { header: 'Steps', key: 'steps', width: 60 }, { header: 'Expected Result', key: 'expected', width: 50 },
    { header: 'Covers AC', key: 'ac', width: 12 }, { header: 'Status', key: 'status', width: 11 },
    { header: 'Automated', key: 'auto', width: 11 }, { header: 'Last Automated Run', key: 'run', width: 24 }, { header: 'Last Run Error', key: 'err', width: 50 },
  ];
  for (const t of p.tickets) for (const tc of t.testCases) {
    tcs.addRow({ key: tc.key, ticket: t.key, ttitle: t.title, title: tc.title, type: tc.type, priority: tc.priority, pre: tc.preconditions, steps: stepsText(tc), expected: tc.expected, ac: (tc.acRef || []).map((n) => `AC${n}`).join(', '), status: tc.status, auto: tc.script ? 'Yes' : 'No', run: lastRun(tc), err: tc.lastRun?.error || '' });
  }
  header(tcs);
  tcs.getColumn('status').eachCell((c, i) => { if (i > 1) c.dataValidation = { type: 'list', allowBlank: true, formulae: ['"Not run,Pass,Fail,Blocked"'] }; });

  if ((p.sprints || []).length) {
    const sp = wb.addWorksheet('Sprints');
    sp.columns = [
      { header: 'Sprint', key: 'name', width: 24 }, { header: 'State', key: 'state', width: 10 }, { header: 'Start', key: 'start', width: 14 }, { header: 'End', key: 'end', width: 14 },
      { header: 'Goal', key: 'goal', width: 50 }, { header: 'Issues', key: 'n', width: 9 }, { header: 'Committed SP', key: 'c', width: 14 }, { header: 'Completed SP', key: 'd', width: 14 },
    ];
    for (const s2 of p.sprints) {
      const ts = p.tickets.filter((t) => t.sprintId === s2.id);
      sp.addRow({ name: s2.name, state: s2.state, start: s2.startDate || '', end: s2.endDate || '', goal: s2.goal || '', n: ts.length, c: s2.committedPoints ?? '', d: s2.completedPoints ?? '' });
    }
    header(sp);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------- Word ----------
export async function toDocx(p) {
  const kids = [];
  const H = (text, heading) => new Paragraph({ text, heading, spacing: { before: 240, after: 120 } });
  const P = (text, opts = {}) => new Paragraph({ children: [new TextRun({ text: String(text ?? ''), ...opts })], spacing: { after: 80 } });
  const label = (l, v) => new Paragraph({ children: [new TextRun({ text: `${l}: `, bold: true }), new TextRun(String(v ?? ''))], spacing: { after: 60 } });
  const bullets = (items) => items.map((x) => new Paragraph({ text: x, bullet: { level: 0 }, spacing: { after: 40 } }));
  const multiline = (text) => String(text || '').split('\n').map((l) => P(l));
  const cell = (text, opts = {}) => new TableCell({
    children: String(text ?? '').split('\n').map((l) => new Paragraph({ children: [new TextRun({ text: l, bold: opts.bold, color: opts.color, size: 18 })] })),
    shading: opts.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.fill } : undefined,
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
  });

  kids.push(new Paragraph({ text: p.name, heading: HeadingLevel.TITLE }));
  kids.push(P(`Backlog, acceptance criteria and test plan · ${p.key} · ${new Date().toLocaleDateString()}`, { color: '666666' }));
  if (p.sourceName) kids.push(label('Source document', p.sourceName));
  kids.push(label('Totals', `${p.epics.length} epics · ${p.tickets.length} tickets · ${p.tickets.reduce((s, t) => s + (t.storyPoints || 0), 0)} story points · ${p.tickets.reduce((s, t) => s + t.testCases.length, 0)} test cases`));
  if (p.summary) { kids.push(H('Summary', HeadingLevel.HEADING_1)); kids.push(...multiline(p.summary)); }
  if (p.assumptions?.length) { kids.push(H('Assumptions', HeadingLevel.HEADING_2)); kids.push(...bullets(p.assumptions)); }
  if (p.openQuestions?.length) { kids.push(H('Open questions', HeadingLevel.HEADING_2)); kids.push(...bullets(p.openQuestions)); }

  for (const { epic, tickets } of groups(p)) {
    kids.push(new Paragraph({ children: [new PageBreak()] }));
    kids.push(H(`${epic.key} · ${epic.title}`, HeadingLevel.HEADING_1));
    if (epic.description) kids.push(...multiline(epic.description));
    for (const t of tickets) {
      kids.push(H(`${t.key} · ${t.title}`, HeadingLevel.HEADING_2));
      kids.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ children: ['Type', 'Priority', 'Story points', 'Status', 'Assignee'].map((h) => cell(h, { bold: true, fill: 'EEF2FF', width: 20 })) }),
          new TableRow({ children: [t.type, t.priority, t.storyPoints ?? '—', t.status, t.assignee || 'Unassigned'].map((v) => cell(v, { width: 20 })) }),
        ],
      }));
      if (t.labels.length) kids.push(label('Labels', t.labels.join(', ')));
      if (t.userStory) { kids.push(H('User story', HeadingLevel.HEADING_3)); kids.push(P(t.userStory, { italics: true })); }
      if (t.description) { kids.push(H('Description', HeadingLevel.HEADING_3)); kids.push(...multiline(t.description)); }
      if (t.acceptanceCriteria.length) {
        kids.push(H('Acceptance criteria', HeadingLevel.HEADING_3));
        t.acceptanceCriteria.forEach((a, i) => kids.push(new Paragraph({ children: [new TextRun({ text: `AC${i + 1}  `, bold: true }), new TextRun(a)], spacing: { after: 60 } })));
      }
      if (t.dependencies.length) { kids.push(H('Dependencies', HeadingLevel.HEADING_3)); kids.push(...bullets(t.dependencies)); }
      if (t.testCases.length) {
        kids.push(H('Test cases', HeadingLevel.HEADING_3));
        kids.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ tableHeader: true, children: ['ID', 'Test', 'Steps', 'Expected'].map((h, i) => cell(h, { bold: true, color: 'FFFFFF', fill: '4F46E5', width: [14, 26, 34, 26][i] })) }),
            ...t.testCases.map((tc) => new TableRow({ children: [
              cell(`${tc.key}\n${tc.type} · ${tc.priority}`, { width: 14 }),
              cell(`${tc.title}${tc.preconditions ? `\nPre: ${tc.preconditions}` : ''}`, { width: 26 }),
              cell(stepsText(tc), { width: 34 }),
              cell(tc.expected, { width: 26 }),
            ] })),
          ],
        }));
      }
    }
  }

  const doc = new Document({
    creator: 'TicketForge',
    title: p.name,
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    sections: [{
      children: kids,
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [`${p.name} · page `, PageNumber.CURRENT], size: 16, color: '888888' })] })] }) },
    }],
  });
  return Packer.toBuffer(doc);
}

// ---------- PDF ----------
export function toPdf(p) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true, info: { Title: p.name, Creator: 'TicketForge' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const W = doc.page.width - 100;
    const ink = '#1f2937', muted = '#6b7280', accent = '#4f46e5';
    const ensure = (h) => { if (doc.y + h > doc.page.height - 70) doc.addPage(); };
    const heading = (text, size, color = ink) => { ensure(size * 3); doc.moveDown(0.6).font('Helvetica-Bold').fontSize(size).fillColor(color).text(text, { width: W }); doc.moveDown(0.25); };
    const body = (text, opts = {}) => { if (!text) return; doc.font(opts.bold ? 'Helvetica-Bold' : opts.italic ? 'Helvetica-Oblique' : 'Helvetica').fontSize(opts.size || 10).fillColor(opts.color || ink).text(String(text), { width: W, indent: opts.indent || 0, ...opts.o }); };
    const kv = (k, v) => { doc.font('Helvetica-Bold').fontSize(10).fillColor(ink).text(`${k}: `, { continued: true }).font('Helvetica').text(String(v ?? '')); };

    // Cover
    doc.rect(0, 0, doc.page.width, 8).fill(accent);
    doc.moveDown(2).font('Helvetica-Bold').fontSize(24).fillColor(ink).text(p.name, { width: W });
    body(`Backlog, acceptance criteria and test plan · ${p.key} · ${new Date().toLocaleDateString()}`, { color: muted });
    doc.moveDown();
    if (p.sourceName) kv('Source document', p.sourceName);
    kv('Totals', `${p.epics.length} epics · ${p.tickets.length} tickets · ${p.tickets.reduce((s, t) => s + (t.storyPoints || 0), 0)} SP · ${p.tickets.reduce((s, t) => s + t.testCases.length, 0)} test cases`);
    if (p.summary) { heading('Summary', 14); body(p.summary); }
    if (p.assumptions?.length) { heading('Assumptions', 12); p.assumptions.forEach((a) => body(`•  ${a}`, { indent: 8 })); }
    if (p.openQuestions?.length) { heading('Open questions', 12); p.openQuestions.forEach((a) => body(`•  ${a}`, { indent: 8 })); }
    heading('Epics', 14);
    for (const { epic, tickets } of groups(p)) body(`${epic.key}  ${epic.title} — ${tickets.length} tickets, ${tickets.reduce((s, t) => s + (t.storyPoints || 0), 0)} SP`);

    for (const { epic, tickets } of groups(p)) {
      doc.addPage();
      doc.rect(50, doc.y, 4, 22).fill(epic.color || accent);
      doc.font('Helvetica-Bold').fontSize(18).fillColor(ink).text(`${epic.key} · ${epic.title}`, 62, doc.y + 2, { width: W - 12 });
      doc.x = 50;
      doc.moveDown(0.4);
      body(epic.description, { color: muted });
      for (const t of tickets) {
        ensure(120);
        doc.moveDown(0.8);
        doc.moveTo(50, doc.y).lineTo(50 + W, doc.y).strokeColor('#e5e7eb').lineWidth(1).stroke();
        doc.moveDown(0.5);
        body(`${t.key}  ${t.title}`, { bold: true, size: 13 });
        body(`${t.type} · ${t.priority} priority · ${t.storyPoints ?? '—'} SP · ${t.status}${t.assignee ? ` · ${t.assignee}` : ''}${t.labels.length ? ` · ${t.labels.join(', ')}` : ''}`, { color: muted, size: 9 });
        if (t.userStory) { doc.moveDown(0.4); body(t.userStory, { italic: true }); }
        if (t.description) { heading('Description', 10.5, accent); body(t.description); }
        if (t.acceptanceCriteria.length) {
          heading('Acceptance criteria', 10.5, accent);
          t.acceptanceCriteria.forEach((a, i) => { ensure(30); doc.font('Helvetica-Bold').fontSize(10).fillColor(ink).text(`AC${i + 1}  `, { continued: true, width: W }).font('Helvetica').text(a); doc.moveDown(0.15); });
        }
        if (t.dependencies.length) { heading('Dependencies', 10.5, accent); t.dependencies.forEach((d) => body(`•  ${d}`, { indent: 8 })); }
        if (t.testCases.length) {
          heading('Test cases', 10.5, accent);
          for (const tc of t.testCases) {
            ensure(70);
            const top = doc.y;
            doc.x = 62;
            doc.font('Helvetica-Bold').fontSize(9.5).fillColor(ink).text(`${tc.key}  ${tc.title}`, { width: W - 12 });
            doc.font('Helvetica').fontSize(8.5).fillColor(muted).text(`${tc.type} · ${tc.priority}${tc.acRef?.length ? ` · covers ${tc.acRef.map((n) => `AC${n}`).join(', ')}` : ''}`, { width: W - 12 });
            doc.fillColor(ink).fontSize(9);
            if (tc.preconditions) doc.text(`Preconditions: ${tc.preconditions}`, { width: W - 12 });
            (tc.steps || []).forEach((s, i) => doc.text(`${i + 1}. ${s}`, { width: W - 24, indent: 8 }));
            doc.font('Helvetica-Bold').text('Expected: ', { continued: true, width: W - 12 }).font('Helvetica').text(tc.expected || '');
            doc.rect(50, top - 2, 3, doc.y - top + 2).fill('#c7d2fe');
            doc.x = 50;
            doc.moveDown(0.5);
          }
        }
      }
    }
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(8).fillColor(muted).text(`${p.name} · ${i + 1} / ${range.count}`, 50, doc.page.height - 40, { width: W, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}

// ---------- HTML ----------
export function toHtml(p) {
  const totalSp = p.tickets.reduce((s, t) => s + (t.storyPoints || 0), 0);
  const totalTc = p.tickets.reduce((s, t) => s + t.testCases.length, 0);
  const nl = (s) => esc(s).replace(/\n/g, '<br>');
  const ticketHtml = (t) => `
    <article class="ticket" data-search="${esc([t.key, t.title, t.userStory, t.description, ...t.labels].join(' ').toLowerCase())}">
      <details>
        <summary>
          <span class="key">${esc(t.key)}</span><span class="title">${esc(t.title)}</span>
          <span class="chips"><span class="chip type-${esc(t.type.toLowerCase())}">${esc(t.type)}</span><span class="chip prio-${esc(t.priority.toLowerCase())}">${esc(t.priority)}</span><span class="chip">${esc(t.status)}</span><span class="chip">${t.storyPoints ?? '—'} SP</span>${t.assignee ? `<span class="chip">${esc(t.assignee)}</span>` : ''}<span class="chip">${t.testCases.length} tests</span></span>
        </summary>
        <div class="body">
          ${t.labels.length ? `<p class="labels">${t.labels.map((l) => `<span class="label">${esc(l)}</span>`).join('')}</p>` : ''}
          ${t.userStory ? `<blockquote>${nl(t.userStory)}</blockquote>` : ''}
          ${t.description ? `<h4>Description</h4><p>${nl(t.description)}</p>` : ''}
          ${t.acceptanceCriteria.length ? `<h4>Acceptance criteria</h4><ol class="ac">${t.acceptanceCriteria.map((a) => `<li>${nl(a)}</li>`).join('')}</ol>` : ''}
          ${t.dependencies.length ? `<h4>Dependencies</h4><ul>${t.dependencies.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
          ${t.testCases.length ? `<h4>Test cases</h4><div class="tablewrap"><table><thead><tr><th>ID</th><th>Test</th><th>Steps</th><th>Expected</th></tr></thead><tbody>${t.testCases.map((tc) => `
            <tr><td><b>${esc(tc.key)}</b><br><small>${esc(tc.type)} · ${esc(tc.priority)}${tc.acRef?.length ? `<br>${tc.acRef.map((n) => `AC${n}`).join(', ')}` : ''}</small></td>
            <td>${esc(tc.title)}${tc.preconditions ? `<br><small>Pre: ${esc(tc.preconditions)}</small>` : ''}</td>
            <td><ol>${(tc.steps || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol></td><td>${nl(tc.expected)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        </div>
      </details>
    </article>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.name)} · Backlog</title>
<style>
:root{--bg:#f7f7fb;--card:#fff;--ink:#1f2937;--muted:#6b7280;--line:#e5e7eb;--accent:#4f46e5;--soft:#eef2ff}
@media (prefers-color-scheme:dark){:root{--bg:#0f1117;--card:#171a23;--ink:#e5e7eb;--muted:#9ca3af;--line:#2a2f3c;--accent:#818cf8;--soft:#1e2235}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:1040px;margin:0 auto;padding:32px 16px 80px}h1{margin:0 0 4px;font-size:28px}.sub{color:var(--muted);margin:0 0 20px}
.stats{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0 24px}.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px;min-width:120px}.stat b{display:block;font-size:22px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin:0 0 16px}
.epic{margin:28px 0 12px;padding-left:12px;border-left:4px solid var(--c,var(--accent))}.epic h2{margin:0;font-size:20px}.epic p{margin:4px 0 0;color:var(--muted)}
.ticket{background:var(--card);border:1px solid var(--line);border-radius:12px;margin:8px 0}summary{cursor:pointer;padding:12px 16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;list-style:none}summary::-webkit-details-marker{display:none}
.key{font:600 12px ui-monospace,monospace;color:var(--accent);background:var(--soft);padding:2px 8px;border-radius:6px}.title{font-weight:600;flex:1;min-width:200px}
.chips{display:flex;gap:6px;flex-wrap:wrap}.chip{font-size:12px;border:1px solid var(--line);border-radius:999px;padding:1px 9px;color:var(--muted)}
.prio-highest,.prio-high{color:#dc2626;border-color:#fecaca}.type-bug{color:#dc2626}.type-spike{color:#7c3aed}
.body{padding:0 18px 16px;border-top:1px solid var(--line)}h4{margin:16px 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
blockquote{margin:14px 0 0;padding:10px 14px;background:var(--soft);border-radius:8px;font-style:italic}.ac li{margin:4px 0}
.label{display:inline-block;font-size:12px;background:var(--soft);color:var(--accent);border-radius:6px;padding:1px 8px;margin:10px 6px 0 0}
.tablewrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:13.5px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid var(--line);padding:8px}th{background:var(--soft)}td ol{margin:0;padding-left:18px}small{color:var(--muted)}
.tools{position:sticky;top:0;background:var(--bg);padding:10px 0;z-index:2;display:flex;gap:8px}input{flex:1;padding:10px 14px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink);font:inherit}
button{padding:8px 14px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer;font:inherit}
@media print{.tools{display:none}details{display:block}details>.body{display:block}}
</style></head><body><div class="wrap">
<h1>${esc(p.name)}</h1><p class="sub">${esc(p.key)} · Backlog, acceptance criteria and test plan · exported ${esc(new Date().toLocaleString())}${p.sourceName ? ` · from ${esc(p.sourceName)}` : ''}</p>
<div class="stats"><div class="stat"><b>${p.epics.length}</b>Epics</div><div class="stat"><b>${p.tickets.length}</b>Tickets</div><div class="stat"><b>${totalSp}</b>Story points</div><div class="stat"><b>${totalTc}</b>Test cases</div></div>
${p.summary ? `<div class="card"><h4 style="margin-top:0">Summary</h4><p style="margin:0">${nl(p.summary)}</p></div>` : ''}
${p.assumptions?.length ? `<div class="card"><h4 style="margin-top:0">Assumptions</h4><ul>${p.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
${p.openQuestions?.length ? `<div class="card"><h4 style="margin-top:0">Open questions</h4><ul>${p.openQuestions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
<div class="tools"><input id="q" placeholder="Filter tickets…"><button id="ex">Expand all</button><button id="co">Collapse all</button></div>
${groups(p).map(({ epic, tickets }) => `<section class="epicgroup"><div class="epic" style="--c:${esc(epic.color || '')}"><h2>${esc(epic.key)} · ${esc(epic.title)}</h2>${epic.description ? `<p>${nl(epic.description)}</p>` : ''}</div>${tickets.map(ticketHtml).join('')}</section>`).join('')}
</div><script>
const q=document.getElementById('q');q.addEventListener('input',()=>{const v=q.value.toLowerCase();document.querySelectorAll('.ticket').forEach(t=>t.style.display=t.dataset.search.includes(v)?'':'none')});
document.getElementById('ex').onclick=()=>document.querySelectorAll('details').forEach(d=>d.open=true);
document.getElementById('co').onclick=()=>document.querySelectorAll('details').forEach(d=>d.open=false);
window.addEventListener('beforeprint',()=>document.querySelectorAll('details').forEach(d=>d.open=true));
</script></body></html>`;
}
