import ExcelJS from 'exceljs';
import {
  numbered,
  ticketsOf,
  groups,
  sprintOf,
  keyOf,
  linksText,
  prsText,
  stepsText,
  lastRun,
} from './to-csv-jira';

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
    ws.eachRow((r, i) => {
      if (i > 1) r.alignment = { wrapText: true, vertical: 'top' };
    });
  };

  const ov = wb.addWorksheet('Overview');
  ov.columns = [{ width: 22 }, { width: 100 }];
  const ovRows = [
    ['Project', p.name],
    ['Key', p.key],
    ['Description', p.description || ''],
    ['Source document', p.sourceName],
    ['Summary', p.summary],
    ['Epics', p.epics.length],
    ['Tickets', p.tickets.length],
    ['Story points', p.tickets.reduce((s, t) => s + (t.storyPoints || 0), 0)],
    ['Test cases', p.tickets.reduce((s, t) => s + t.testCases.length, 0)],
    ['Assumptions', numbered(p.assumptions || [])],
    ['Open questions', numbered(p.openQuestions || [])],
    ['Exported', new Date().toLocaleString()],
  ];
  ovRows.forEach((r) => {
    const row = ov.addRow(r);
    row.getCell(1).font = { bold: true };
    row.alignment = { wrapText: true, vertical: 'top' };
  });
  ov.getRow(1).getCell(2).font = { bold: true, size: 14 };

  const ep = wb.addWorksheet('Epics');
  ep.columns = [
    { header: 'Epic Key', key: 'key', width: 12 },
    { header: 'Epic', key: 'title', width: 34 },
    { header: 'Description', key: 'description', width: 70 },
    { header: 'Start Date', key: 'start', width: 12 },
    { header: 'Due Date', key: 'due', width: 12 },
    { header: 'Tickets', key: 'count', width: 10 },
    { header: 'Story Points', key: 'sp', width: 13 },
    { header: 'Test Cases', key: 'tc', width: 12 },
  ];
  for (const e of p.epics) {
    const ts = ticketsOf(p, e);
    ep.addRow({
      key: e.key,
      title: e.title,
      description: e.description,
      start: e.startDate || '',
      due: e.dueDate || '',
      count: ts.length,
      sp: ts.reduce((s, t) => s + (t.storyPoints || 0), 0),
      tc: ts.reduce((s, t) => s + t.testCases.length, 0),
    });
  }
  header(ep);

  const tk = wb.addWorksheet('Tickets');
  tk.columns = [
    { header: 'Key', key: 'key', width: 11 },
    { header: 'Epic', key: 'epic', width: 26 },
    { header: 'Title', key: 'title', width: 40 },
    { header: 'Type', key: 'type', width: 9 },
    { header: 'Priority', key: 'priority', width: 10 },
    { header: 'SP', key: 'sp', width: 6 },
    { header: 'Status', key: 'status', width: 11 },
    { header: 'Assignee', key: 'assignee', width: 16 },
    { header: 'Sprint', key: 'sprint', width: 16 },
    { header: 'Parent', key: 'parent', width: 10 },
    { header: 'Labels', key: 'labels', width: 16 },
    { header: 'User Story', key: 'story', width: 50 },
    { header: 'Description', key: 'description', width: 60 },
    { header: 'Acceptance Criteria', key: 'ac', width: 80 },
    { header: 'Dependencies', key: 'deps', width: 30 },
    { header: 'Linked Issues', key: 'links', width: 28 },
    { header: 'Pull Requests', key: 'prs', width: 40 },
    { header: 'Test Cases', key: 'tc', width: 10 },
  ];
  for (const { epic, tickets } of groups(p))
    for (const t of tickets) {
      tk.addRow({
        key: t.key,
        epic: epic.title,
        title: t.title,
        type: t.type,
        priority: t.priority,
        sp: t.storyPoints ?? '',
        status: t.status,
        assignee: t.assignee || '',
        sprint: sprintOf(p, t),
        parent: keyOf(p, t.parentId),
        links: linksText(p, t),
        prs: prsText(t),
        labels: t.labels.join(', '),
        story: t.userStory,
        description: t.description,
        ac: numbered(t.acceptanceCriteria),
        deps: t.dependencies.join('\n'),
        tc: t.testCases.length,
      });
    }
  header(tk);

  const tcs = wb.addWorksheet('Test Cases');
  tcs.columns = [
    { header: 'Test Case', key: 'key', width: 16 },
    { header: 'Ticket', key: 'ticket', width: 11 },
    { header: 'Ticket Title', key: 'ttitle', width: 32 },
    { header: 'Title', key: 'title', width: 40 },
    { header: 'Type', key: 'type', width: 13 },
    { header: 'Priority', key: 'priority', width: 10 },
    { header: 'Preconditions', key: 'pre', width: 36 },
    { header: 'Steps', key: 'steps', width: 60 },
    { header: 'Expected Result', key: 'expected', width: 50 },
    { header: 'Covers AC', key: 'ac', width: 12 },
    { header: 'Status', key: 'status', width: 11 },
    { header: 'Automated', key: 'auto', width: 11 },
    { header: 'Last Automated Run', key: 'run', width: 24 },
    { header: 'Last Run Error', key: 'err', width: 50 },
  ];
  for (const t of p.tickets)
    for (const tc of t.testCases) {
      tcs.addRow({
        key: tc.key,
        ticket: t.key,
        ttitle: t.title,
        title: tc.title,
        type: tc.type,
        priority: tc.priority,
        pre: tc.preconditions,
        steps: stepsText(tc),
        expected: tc.expected,
        ac: (tc.acRef || []).map((n) => `AC${n}`).join(', '),
        status: tc.status,
        auto: tc.script ? 'Yes' : 'No',
        run: lastRun(tc),
        err: tc.lastRun?.error || '',
      });
    }
  header(tcs);
  tcs.getColumn('status').eachCell((c, i) => {
    if (i > 1)
      c.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"Not run,Pass,Fail,Blocked"'],
      };
  });

  if ((p.sprints || []).length) {
    const sp = wb.addWorksheet('Sprints');
    sp.columns = [
      { header: 'Sprint', key: 'name', width: 24 },
      { header: 'State', key: 'state', width: 10 },
      { header: 'Start', key: 'start', width: 14 },
      { header: 'End', key: 'end', width: 14 },
      { header: 'Goal', key: 'goal', width: 50 },
      { header: 'Issues', key: 'n', width: 9 },
      { header: 'Committed SP', key: 'c', width: 14 },
      { header: 'Completed SP', key: 'd', width: 14 },
    ];
    for (const s2 of p.sprints) {
      const ts = p.tickets.filter((t) => t.sprintId === s2.id);
      sp.addRow({
        name: s2.name,
        state: s2.state,
        start: s2.startDate || '',
        end: s2.endDate || '',
        goal: s2.goal || '',
        n: ts.length,
        c: s2.committedPoints ?? '',
        d: s2.completedPoints ?? '',
      });
    }
    header(sp);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
