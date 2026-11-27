// Builds a Problem Statement .docx from the team's own template: everything that makes it theirs (styles, fonts,
// cover, logo, header, footer) is kept, and the body is rebuilt by cloning the template's own paragraphs and table
// rows with the new text. Works with any template laid out like the Problem Statement one: a cover with the feature
// name, numbered Heading 1 sections, tables, then "Document Control", "Sign-Off" and "Revision History".
import JSZip from 'jszip';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
const textOf = (xml) =>
  xml
    .replace(/<w:tab\/>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

/** Elements of one kind at the top level of `xml`, with nesting handled. */
function elements(xml, tag) {
  const out: any[] = [];
  const re = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'g');
  let depth = 0,
    start = -1,
    m;
  while ((m = re.exec(xml))) {
    if (m[1] === '' && m[2] === '/') {
      if (!depth) out.push(xml.slice(m.index, re.lastIndex));
      continue;
    }
    if (m[1] === '') {
      if (!depth) start = m.index;
      depth++;
    } else if (--depth === 0) out.push(xml.slice(start, re.lastIndex));
  }
  return out;
}
/** Top-level blocks of the body: paragraphs, tables and the section properties, in order. */
function blocksOf(body) {
  const out: any[] = [];
  const re = /<(w:p|w:tbl|w:sectPr)\b/g;
  let m,
    from = 0;
  while ((m = re.exec(body))) {
    if (m.index < from) continue;
    const [el] = elements(body.slice(m.index), m[1]);
    out.push({ tag: m[1], xml: el, text: textOf(el) });
    from = m.index + el.length;
    re.lastIndex = from;
  }
  return out;
}
const pPrOf = (p) => (p.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [''])[0];
const textRuns = (p) => elements(p, 'w:r').filter((r) => /<w:t[ >]/.test(r));
const rPrOf = (r) => (r?.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || ['<w:rPr/>'])[0];
const isNum = (p) => /<w:numPr>/.test(pPrOf(p));
const styleOf = (p) => (pPrOf(p).match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || '';

/**
 * A paragraph like `proto`, with new text. segs: [{ text, lead }]: lead segments use the template's lead style
 * (its first run: Medium or bold), the rest its body style (its last run).
 */
function para(proto, segs) {
  const runs = textRuns(proto);
  const lead = rPrOf(runs[0]),
    body = rPrOf(runs[runs.length - 1] || runs[0]);
  const rs = segs
    .filter((s) => s.text)
    .map((s) => `<w:r>${s.lead ? lead : body}<w:t xml:space="preserve">${esc(s.text)}</w:t></w:r>`)
    .join('');
  return `<w:p>${pPrOf(proto)}${rs}</w:p>`;
}
/** A table like `proto`: its header row with `headers`, and one cloned body row per item of `rows`. */
function table(proto, headers, rows, cellBullet?) {
  const trs = elements(proto, 'w:tr');
  const head = proto.slice(0, proto.indexOf(trs[0]));
  const fillRow = (tr, cells) => {
    const tcs = elements(tr, 'w:tc');
    let i = 0;
    return tr.replace(/<w:tc>[\s\S]*?<\/w:tc>(?=\s*(<w:tc>|<\/w:tr>))/g, () => {
      const tc = tcs[i] || tcs[tcs.length - 1];
      const ps = elements(tc, 'w:p');
      const pProto = ps.find((p) => !isNum(p)) || ps[0];
      const bProto = ps.find(isNum) || cellBullet || pProto;
      const items = cells[i++] ?? [];
      const content = (Array.isArray(items) ? items : [{ segs: [{ text: String(items) }] }]).map(
        (it) => para(it.bullet ? bProto : pProto, it.segs),
      );
      return `<w:tc>${(tc.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/) || [''])[0]}${content.join('') || para(pProto, [])}</w:tc>`;
    });
  };
  return `${head}${fillRow(trs[0], headers)}${rows.map((r) => fillRow(trs[1] || trs[0], r)).join('')}</w:tbl>`;
}
const cols = (tbl) => elements(elements(tbl, 'w:tr')[0] || '', 'w:tc').length;
const firstCell = (tbl) => textOf(elements(elements(tbl, 'w:tr')[0] || '', 'w:tc')[0] || '');

/** Reads a template: what it has and what it calls things. Throws when it doesn't look like a Problem Statement. */
export async function inspectTemplate(buf) {
  const zip = await JSZip.loadAsync(buf);
  const doc = await zip.file('word/document.xml')?.async('string');
  if (!doc) throw Object.assign(new Error('That isn’t a Word document (.docx).'), { status: 400 });
  const body = doc.slice(doc.indexOf('<w:body>') + 8, doc.lastIndexOf('</w:body>'));
  const blocks = blocksOf(body);
  const h1 = blocks.findIndex((b) => b.tag === 'w:p' && styleOf(b.xml) === 'Heading1' && b.text);
  const dc = blocks.findIndex((b) => b.tag === 'w:p' && /^document control$/i.test(b.text));
  if (h1 < 0)
    throw Object.assign(
      new Error(
        'The template has no Heading 1 sections. Use a Problem Statement laid out with Word headings.',
      ),
      { status: 400 },
    );
  const region = blocks.slice(h1, dc > 0 ? dc : blocks.length);
  const tables = region.filter((b) => b.tag === 'w:tbl');
  const ps = region.filter((b) => b.tag === 'w:p');
  const P = {
    h1: ps.find((b) => styleOf(b.xml) === 'Heading1' && b.text)?.xml,
    h2: ps.find((b) => styleOf(b.xml) === 'Heading2' && b.text)?.xml,
    bulletLead: ps.find((b) => isNum(b.xml) && textRuns(b.xml).length >= 2)?.xml,
    bullet: ps.find((b) => isNum(b.xml) && textRuns(b.xml).length === 1)?.xml,
    callout: ps.find((b) => /<w:pBdr>|<w:shd /.test(pPrOf(b.xml)) && b.text)?.xml,
    label: ps.find(
      (b) =>
        !isNum(b.xml) &&
        !styleOf(b.xml) &&
        b.text &&
        b.text.length < 90 &&
        textRuns(b.xml).length === 1 &&
        /Medium|<w:b\b/.test(rPrOf(textRuns(b.xml)[0])),
    )?.xml,
    normal: ps.find(
      (b) => !isNum(b.xml) && !styleOf(b.xml) && b.text.length > 90 && !/<w:pBdr>/.test(b.xml),
    )?.xml,
    spacer:
      ps.find((b) => !b.text && !styleOf(b.xml) && !/<w:drawing|<w:pict/.test(b.xml))?.xml ||
      '<w:p/>',
  };
  P.bullet ??= P.bulletLead;
  P.bulletLead ??= P.bullet;
  P.h2 ??= P.h1;
  P.callout ??= P.normal;
  P.label ??= P.normal;
  const T = {
    two: tables.find((t) => cols(t.xml) === 2)?.xml,
    three: tables.filter((t) => cols(t.xml) === 3).map((t) => t.xml),
    four: tables.find((t) => cols(t.xml) === 4)?.xml,
  };
  const anyTable = tables[0]?.xml;
  const cellBullet = tables.map((t) => elements(t.xml, 'w:p').find(isNum)).find(Boolean);
  const missing = ['h1', 'normal', 'bullet'].filter((k) => !P[k]);
  if (missing.length || !anyTable)
    throw Object.assign(
      new Error(
        `The template is missing ${missing.length ? `${missing.join(', ')} paragraphs` : 'tables'}. Use a Problem Statement with headings, paragraphs, bullets and tables.`,
      ),
      { status: 400 },
    );
  // What the template calls things, so the cover, header and Document Control can be updated.
  const cover = blocks
    .slice(0, h1)
    .find(
      (b) =>
        b.text &&
        /<w:sz w:val="(\d+)"/.test(b.xml) &&
        Number(b.xml.match(/<w:sz w:val="(\d+)"/)[1]) >= 48,
    );
  const back = dc > 0 ? blocks.slice(dc) : [];
  const dcTable = back.find((b) => b.tag === 'w:tbl' && /^document$/i.test(firstCell(b.xml)));
  const dcRow = dcTable ? elements(elements(dcTable.xml, 'w:tr')[1] || '', 'w:tc').map(textOf) : [];
  return {
    zip,
    doc,
    body,
    blocks,
    h1,
    dc,
    P,
    T,
    anyTable,
    cellBullet,
    names: {
      title: cover?.text || '',
      document: dcRow[0] || '',
      version: dcRow[1] || '',
      date: dcRow[2] || '',
      status: dcRow[3] || '',
      product: (dcRow[0] || '').split(/\s+[–-]\s+/)[0] || '',
    },
    info: {
      sections: region
        .filter((b) => b.tag === 'w:p' && styleOf(b.xml) === 'Heading1' && b.text)
        .map((b) => b.text),
      tables: tables.length,
      backMatter: Boolean(dcTable),
      coverTitle: cover?.text || null,
    },
  };
}

/** Replaces text inside <w:t> runs only (never markup). */
const replaceText = (xml, map) =>
  xml.replace(/(<w:t(?: [^>]*)?>)([^<]*)(<\/w:t>)/g, (_m, a, t, b) => {
    let out = t;
    for (const [from, to] of map) if (from) out = out.split(esc(from)).join(esc(to));
    return a + out + b;
  });

/**
 * The finished .docx for one PSD. meta: { version, status, date, preparedBy, description }.
 */
export async function buildPsdDocx(templateBuf, psd, meta: any = {}) {
  const t = await inspectTemplate(templateBuf);
  const { P, T } = t;
  const three = (i) => T.three[i] || T.three[0] || t.anyTable;
  const out: any[] = [];
  const h1 = (text) => out.push(para(P.h1, [{ text }]));
  const spacer = () => out.push(P.spacer);
  const lead = (l, x) => [{ text: l, lead: true }, { text: l ? ` ${x}` : x }];
  const cell = (text) => [{ segs: [{ text }] }];

  h1('1. At a Glance');
  const g = psd.atAGlance || {};
  for (const [l, x] of [
    ['The problem:', g.problem],
    ['Why it matters:', g.whyItMatters],
    ['Who is affected:', g.whoIsAffected],
    ['What is proposed:', g.whatIsProposed],
  ])
    if (x) out.push(para(P.bulletLead, lead(l, x)));
  if (psd.definition) out.push(para(P.callout, lead(psd.definition.term, psd.definition.text)));

  h1('2. Background and Current Situation');
  if (psd.background?.context) out.push(para(P.normal, [{ text: psd.background.context }]));
  if (psd.background?.today?.length) {
    out.push(para(P.label, [{ text: 'What happens today', lead: true }]));
    for (const x of psd.background.today) out.push(para(P.bullet, [{ text: x }]));
  }

  h1('3. Problem Statement');
  if (psd.problemStatement) out.push(para(P.normal, [{ text: psd.problemStatement }]));
  if (psd.gaps?.length) {
    spacer();
    out.push(para(P.label, [{ text: psd.gapsTitle, lead: true }]));
    out.push(
      table(
        T.two || t.anyTable,
        ['Gap', 'What it means'],
        psd.gaps.map((x) => [
          cell(x.gap),
          [
            { segs: [{ text: x.meaning }] },
            ...x.examples.map((e) => ({
              bullet: true,
              segs: e.area
                ? [{ text: `${e.area}:`, lead: true }, { text: ` ${e.text}` }]
                : [{ text: e.text }],
            })),
          ],
        ]),
        t.cellBullet,
      ),
    );
    spacer();
  }

  h1('4. Who Is Affected');
  out.push(
    table(
      three(0),
      ['Who', psd.relationshipHeader, 'How they are affected'],
      psd.affected.map((x) => [cell(x.who), cell(x.relationship), cell(x.how)]),
      t.cellBullet,
    ),
  );
  spacer();

  h1(`5. Impact on ${psd.product || 'the Business'} as a Business`);
  out.push(
    table(
      three(1),
      ['Pain point', 'What happens today', `Consequence for ${psd.product || 'the business'}`],
      psd.business.map((x) => [cell(x.pain), cell(x.today), cell(x.consequence)]),
      t.cellBullet,
    ),
  );
  spacer();

  h1('6. Impact on Users');
  for (const u of psd.users) {
    out.push(para(P.h2, [{ text: u.role }]));
    out.push(
      table(
        three(2),
        ['When this happens…', 'What they cannot do today', 'Consequence for them'],
        u.rows.map((r) => [cell(r.when), cell(r.cannot), cell(r.consequence)]),
        t.cellBullet,
      ),
    );
    spacer();
  }

  h1('7. Cost of Inaction');
  for (const c of psd.costOfInaction) out.push(para(P.bulletLead, lead(c.lead, c.text)));

  h1('8. Evidence Needed for the Problem Gate');
  out.push(
    table(
      T.four || t.anyTable,
      ['Evidence', 'What it proves', 'Suggested source', 'Status'],
      psd.evidence.map((x) => [cell(x.evidence), cell(x.proves), cell(x.source), cell(x.status)]),
      t.cellBullet,
    ),
  );

  // Cover: the feature name.
  const version = meta.version || 'v1.0',
    status = meta.status || 'Draft',
    date =
      meta.date ||
      new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const product = psd.product || t.names.product;
  const map = [
    [t.names.document, `${product} – ${psd.title}: Problem Statement`],
    [t.names.title, psd.title],
    [t.names.product, product],
    [t.names.version, version],
    [t.names.status, status],
  ]
    .filter(([a]) => a)
    .sort((a, b) => b[0].length - a[0].length);
  const head = t.blocks
    .slice(0, t.h1)
    .map((b) =>
      b.text && b.text === t.names.title ? replaceText(b.xml, [[t.names.title, psd.title]]) : b.xml,
    );

  // Back matter: Document Control filled in, Sign-off emptied (names, signatures and dates are filled in by people),
  // one Revision History entry. Pictures in the sign-off area (signatures) are not carried over.
  const back = t.dc > 0 ? t.blocks.slice(t.dc).filter((b) => b.tag !== 'w:sectPr') : [];
  const backXml = back.map((b) => {
    if (b.tag === 'w:p')
      return b.xml.replace(
        /<w:drawing>[\s\S]*?<\/w:drawing>|<mc:AlternateContent>[\s\S]*?<\/mc:AlternateContent>|<w:pict>[\s\S]*?<\/w:pict>/g,
        '',
      );
    const first = firstCell(b.xml);
    const trs = elements(b.xml, 'w:tr');
    const headers = elements(trs[0], 'w:tc').map((c) => cell(textOf(c)));
    if (/^document$/i.test(first))
      return table(b.xml, headers, [
        [
          cell(`${product} – ${psd.title}: Problem Statement`),
          cell(version),
          cell(date),
          cell(status),
        ],
      ]);
    if (/^role$/i.test(first))
      return table(
        b.xml,
        headers,
        trs
          .slice(1)
          .map((tr) => [cell(textOf(elements(tr, 'w:tc')[0] || '')), cell(''), cell(''), cell('')]),
      );
    if (/^version$/i.test(first))
      return table(b.xml, headers, [
        [
          cell(version),
          cell(meta.preparedBy || ''),
          cell(meta.description || 'First draft, written from the epic and its issues.'),
          cell(date),
        ],
      ]);
    return b.xml;
  });
  const sect = t.blocks.find((b) => b.tag === 'w:sectPr')?.xml || '';
  // Keep the template's last spacer before Document Control so it starts where it did.
  const before =
    t.dc > 0
      ? t.blocks
          .slice(t.dc - 2, t.dc)
          .filter((b) => b.tag === 'w:p' && !b.text)
          .map((b) => b.xml)
      : [];
  const newBody = [...head, ...out, ...before, ...backXml, sect].join('');
  const docXml =
    t.doc.slice(0, t.doc.indexOf('<w:body>') + 8) +
    newBody +
    t.doc.slice(t.doc.lastIndexOf('</w:body>'));
  t.zip.file('word/document.xml', docXml);
  // Header and footer: product, feature name, version and status.
  for (const name of Object.keys(t.zip.files).filter((n) =>
    /^word\/(header|footer)\d*\.xml$/.test(n),
  )) {
    t.zip.file(name, replaceText(await t.zip.file(name).async('string'), map));
  }
  // Document properties.
  const core = t.zip.file('docProps/core.xml');
  if (core)
    t.zip.file(
      'docProps/core.xml',
      (await core.async('string')).replace(
        /<dc:title>[\s\S]*?<\/dc:title>/,
        `<dc:title>${esc(`${psd.title}: Problem Statement`)}</dc:title>`,
      ),
    );
  return t.zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export { trimEmbeddedFonts } from './docx-fonts';

/** A plain PSD with the same sections, for when no template has been uploaded. */
export async function buildPlainPsdDocx(psd, meta: any = {}) {
  const d = await import('docx');
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    WidthType,
    AlignmentType,
    ShadingType,
  } = d;
  const P = (text, opts: any = {}) =>
    new Paragraph({ children: [new TextRun({ text, ...opts })], spacing: { after: 120 } });
  const lead = (l, x, bullet = true) =>
    new Paragraph({
      children: [new TextRun({ text: l, bold: true }), new TextRun({ text: l ? ` ${x}` : x })],
      ...(bullet ? { bullet: { level: 0 } } : {}),
      spacing: { after: 80 },
    });
  const H1 = (text) =>
    new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } });
  const H2 = (text) =>
    new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 160, after: 80 } });
  const cellP = (c) =>
    Array.isArray(c)
      ? c
      : [new Paragraph({ children: [new TextRun({ text: String(c ?? ''), size: 19 })] })];
  const T = (headers, rows) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true,
          children: headers.map(
            (h) =>
              new TableCell({
                shading: { type: ShadingType.CLEAR, fill: '0C2A50', color: 'auto' },
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: h, bold: true, color: 'FFFFFF', size: 19 })],
                  }),
                ],
              }),
          ),
        }),
        ...rows.map(
          (r) => new TableRow({ children: r.map((c) => new TableCell({ children: cellP(c) })) }),
        ),
      ],
    });
  const kids = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 2400, after: 120 },
      children: [new TextRun({ text: psd.title, size: 72, color: '0C2A50' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
      children: [new TextRun({ text: 'PROBLEM STATEMENT', size: 22, color: 'C00000' })],
    }),
    H1('1. At a Glance'),
    ...[
      ['The problem:', psd.atAGlance.problem],
      ['Why it matters:', psd.atAGlance.whyItMatters],
      ['Who is affected:', psd.atAGlance.whoIsAffected],
      ['What is proposed:', psd.atAGlance.whatIsProposed],
    ]
      .filter(([, x]) => x)
      .map(([l, x]) => lead(l, x)),
    ...(psd.definition ? [lead(psd.definition.term, psd.definition.text, false)] : []),
    H1('2. Background and Current Situation'),
    P(psd.background.context),
    ...(psd.background.today.length
      ? [P('What happens today', { bold: true }), ...psd.background.today.map((x) => lead('', x))]
      : []),
    H1('3. Problem Statement'),
    P(psd.problemStatement),
    ...(psd.gaps.length
      ? [
          P(psd.gapsTitle, { bold: true }),
          T(
            ['Gap', 'What it means'],
            psd.gaps.map((g) => [
              g.gap,
              [
                new Paragraph({ children: [new TextRun({ text: g.meaning, size: 19 })] }),
                ...g.examples.map(
                  (e) =>
                    new Paragraph({
                      bullet: { level: 0 },
                      children: [
                        new TextRun({ text: e.area ? `${e.area}: ` : '', bold: true, size: 19 }),
                        new TextRun({ text: e.text, size: 19 }),
                      ],
                    }),
                ),
              ],
            ]),
          ),
        ]
      : []),
    H1('4. Who Is Affected'),
    T(
      ['Who', psd.relationshipHeader, 'How they are affected'],
      psd.affected.map((x) => [x.who, x.relationship, x.how]),
    ),
    H1(`5. Impact on ${psd.product || 'the Business'} as a Business`),
    T(
      ['Pain point', 'What happens today', `Consequence for ${psd.product || 'the business'}`],
      psd.business.map((x) => [x.pain, x.today, x.consequence]),
    ),
    H1('6. Impact on Users'),
    ...psd.users.flatMap((u) => [
      H2(u.role),
      T(
        ['When this happens…', 'What they cannot do today', 'Consequence for them'],
        u.rows.map((r) => [r.when, r.cannot, r.consequence]),
      ),
    ]),
    H1('7. Cost of Inaction'),
    ...psd.costOfInaction.map((c) => lead(c.lead, c.text)),
    H1('8. Evidence Needed for the Problem Gate'),
    T(
      ['Evidence', 'What it proves', 'Suggested source', 'Status'],
      psd.evidence.map((x) => [x.evidence, x.proves, x.source, x.status]),
    ),
    H2('Document Control'),
    T(
      ['Document', 'Version', 'Date', 'Status'],
      [
        [
          `${psd.product} – ${psd.title}: Problem Statement`,
          meta.version || 'v1.0',
          meta.date || '',
          meta.status || 'Draft',
        ],
      ],
    ),
    H2('Revision History'),
    T(
      ['Version', 'Revised by', 'Description', 'Date'],
      [
        [
          meta.version || 'v1.0',
          meta.preparedBy || '',
          meta.description || 'First draft, written from the epic and its issues.',
          meta.date || '',
        ],
      ],
    ),
  ];
  return Packer.toBuffer(
    new Document({
      creator: 'TicketForge',
      title: `${psd.title}: Problem Statement`,
      sections: [{ children: kids }],
    }),
  );
}
