import PDFDocument from 'pdfkit';
import { groups, esc } from './to-csv-jira';

// ---------- PDF ----------
export function toPdf(p) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      bufferPages: true,
      info: { Title: p.name, Creator: 'TicketForge' },
    });
    const chunks: any[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const W = doc.page.width - 100;
    const ink = '#1f2937',
      muted = '#6b7280',
      accent = '#4f46e5';
    const ensure = (h) => {
      if (doc.y + h > doc.page.height - 70) doc.addPage();
    };
    const heading = (text, size, color = ink) => {
      ensure(size * 3);
      doc
        .moveDown(0.6)
        .font('Helvetica-Bold')
        .fontSize(size)
        .fillColor(color)
        .text(text, { width: W });
      doc.moveDown(0.25);
    };
    const body = (text, opts: any = {}) => {
      if (!text) return;
      doc
        .font(opts.bold ? 'Helvetica-Bold' : opts.italic ? 'Helvetica-Oblique' : 'Helvetica')
        .fontSize(opts.size || 10)
        .fillColor(opts.color || ink)
        .text(String(text), { width: W, indent: opts.indent || 0, ...opts.o });
    };
    const kv = (k, v) => {
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(ink)
        .text(`${k}: `, { continued: true })
        .font('Helvetica')
        .text(String(v ?? ''));
    };

    // Cover
    doc.rect(0, 0, doc.page.width, 8).fill(accent);
    doc.moveDown(2).font('Helvetica-Bold').fontSize(24).fillColor(ink).text(p.name, { width: W });
    body(
      `Backlog, acceptance criteria and test plan · ${p.key} · ${new Date().toLocaleDateString()}`,
      { color: muted },
    );
    doc.moveDown();
    if (p.sourceName) kv('Source document', p.sourceName);
    kv(
      'Totals',
      `${p.epics.length} epics · ${p.tickets.length} tickets · ${p.tickets.reduce((s, t) => s + (t.storyPoints || 0), 0)} SP · ${p.tickets.reduce((s, t) => s + t.testCases.length, 0)} test cases`,
    );
    if (p.description) {
      heading('Description', 14);
      body(p.description);
    }
    if (p.summary) {
      heading('Summary', 14);
      body(p.summary);
    }
    if (p.assumptions?.length) {
      heading('Assumptions', 12);
      p.assumptions.forEach((a) => body(`•  ${a}`, { indent: 8 }));
    }
    if (p.openQuestions?.length) {
      heading('Open questions', 12);
      p.openQuestions.forEach((a) => body(`•  ${a}`, { indent: 8 }));
    }
    heading('Epics', 14);
    for (const { epic, tickets } of groups(p))
      body(
        `${epic.key}  ${epic.title} — ${tickets.length} tickets, ${tickets.reduce((s, t) => s + (t.storyPoints || 0), 0)} SP`,
      );

    for (const { epic, tickets } of groups(p)) {
      doc.addPage();
      doc.rect(50, doc.y, 4, 22).fill(epic.color || accent);
      doc
        .font('Helvetica-Bold')
        .fontSize(18)
        .fillColor(ink)
        .text(`${epic.key} · ${epic.title}`, 62, doc.y + 2, { width: W - 12 });
      doc.x = 50;
      doc.moveDown(0.4);
      body(epic.description, { color: muted });
      for (const t of tickets) {
        ensure(120);
        doc.moveDown(0.8);
        doc
          .moveTo(50, doc.y)
          .lineTo(50 + W, doc.y)
          .strokeColor('#e5e7eb')
          .lineWidth(1)
          .stroke();
        doc.moveDown(0.5);
        body(`${t.key}  ${t.title}`, { bold: true, size: 13 });
        body(
          `${t.type} · ${t.priority} priority · ${t.storyPoints ?? '—'} SP · ${t.status}${t.assignee ? ` · ${t.assignee}` : ''}${t.labels.length ? ` · ${t.labels.join(', ')}` : ''}`,
          { color: muted, size: 9 },
        );
        if (t.userStory) {
          doc.moveDown(0.4);
          body(t.userStory, { italic: true });
        }
        if (t.description) {
          heading('Description', 10.5, accent);
          body(t.description);
        }
        if (t.acceptanceCriteria.length) {
          heading('Acceptance criteria', 10.5, accent);
          t.acceptanceCriteria.forEach((a, i) => {
            ensure(30);
            doc
              .font('Helvetica-Bold')
              .fontSize(10)
              .fillColor(ink)
              .text(`AC${i + 1}  `, { continued: true, width: W })
              .font('Helvetica')
              .text(a);
            doc.moveDown(0.15);
          });
        }
        if (t.dependencies.length) {
          heading('Dependencies', 10.5, accent);
          t.dependencies.forEach((d) => body(`•  ${d}`, { indent: 8 }));
        }
        if (t.testCases.length) {
          heading('Test cases', 10.5, accent);
          for (const tc of t.testCases) {
            ensure(70);
            const top = doc.y;
            doc.x = 62;
            doc
              .font('Helvetica-Bold')
              .fontSize(9.5)
              .fillColor(ink)
              .text(`${tc.key}  ${tc.title}`, { width: W - 12 });
            doc
              .font('Helvetica')
              .fontSize(8.5)
              .fillColor(muted)
              .text(
                `${tc.type} · ${tc.priority}${tc.acRef?.length ? ` · covers ${tc.acRef.map((n) => `AC${n}`).join(', ')}` : ''}`,
                {
                  width: W - 12,
                },
              );
            doc.fillColor(ink).fontSize(9);
            if (tc.preconditions) doc.text(`Preconditions: ${tc.preconditions}`, { width: W - 12 });
            (tc.steps || []).forEach((s, i) =>
              doc.text(`${i + 1}. ${s}`, { width: W - 24, indent: 8 }),
            );
            doc
              .font('Helvetica-Bold')
              .text('Expected: ', { continued: true, width: W - 12 })
              .font('Helvetica')
              .text(tc.expected || '');
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
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(muted)
        .text(`${p.name} · ${i + 1} / ${range.count}`, 50, doc.page.height - 40, {
          width: W,
          align: 'center',
          lineBreak: false,
        });
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
          ${
            t.testCases.length
              ? `<h4>Test cases</h4><div class="tablewrap"><table><thead><tr><th>ID</th><th>Test</th><th>Steps</th><th>Expected</th></tr></thead><tbody>${t.testCases
                  .map(
                    (tc) => `
            <tr><td><b>${esc(tc.key)}</b><br><small>${esc(tc.type)} · ${esc(tc.priority)}${tc.acRef?.length ? `<br>${tc.acRef.map((n) => `AC${n}`).join(', ')}` : ''}</small></td>
            <td>${esc(tc.title)}${tc.preconditions ? `<br><small>Pre: ${esc(tc.preconditions)}</small>` : ''}</td>
            <td><ol>${(tc.steps || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol></td><td>${nl(tc.expected)}</td></tr>`,
                  )
                  .join('')}</tbody></table></div>`
              : ''
          }
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
${p.description ? `<div class="card"><h4 style="margin-top:0">Description</h4><p style="margin:0">${nl(p.description)}</p></div>` : ''}
${p.summary ? `<div class="card"><h4 style="margin-top:0">Summary</h4><p style="margin:0">${nl(p.summary)}</p></div>` : ''}
${p.assumptions?.length ? `<div class="card"><h4 style="margin-top:0">Assumptions</h4><ul>${p.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
${p.openQuestions?.length ? `<div class="card"><h4 style="margin-top:0">Open questions</h4><ul>${p.openQuestions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
<div class="tools"><input id="q" placeholder="Filter tickets…"><button id="ex">Expand all</button><button id="co">Collapse all</button></div>
${groups(p)
  .map(
    ({ epic, tickets }: any) =>
      `<section class="epicgroup"><div class="epic" style="--c:${esc(epic.color || '')}"><h2>${esc(epic.key)} · ${esc(epic.title)}</h2>${epic.description ? `<p>${nl(epic.description)}</p>` : ''}</div>${tickets.map(ticketHtml).join('')}</section>`,
  )
  .join('')}
</div><script>
const q=document.getElementById('q');q.addEventListener('input',()=>{const v=q.value.toLowerCase();document.querySelectorAll('.ticket').forEach(t=>t.style.display=t.dataset.search.includes(v)?'':'none')});
document.getElementById('ex').onclick=()=>document.querySelectorAll('details').forEach(d=>d.open=true);
document.getElementById('co').onclick=()=>document.querySelectorAll('details').forEach(d=>d.open=false);
window.addEventListener('beforeprint',()=>document.querySelectorAll('details').forEach(d=>d.open=true));
</script></body></html>`;
}
