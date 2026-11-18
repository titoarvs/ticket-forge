// Builds the scrum pain points Word document from its Markdown source.
// Usage: `npm run docs:pain-points`. Reads docs/scrum-pain-points.md, writes docs/scrum-pain-points.docx.
import fs from 'node:fs';
import path from 'node:path';
import { markdownToDocx } from '../lib/md-docx';

const dir = path.join(import.meta.dirname, '..', 'docs');
const src = path.join(dir, 'scrum-pain-points.md');
const out = path.join(dir, 'scrum-pain-points.docx');

const buf = await markdownToDocx(fs.readFileSync(src, 'utf8'), { title: 'Scrum team pain points in the building phase, and how Ticket Forge may help', creator: 'TicketForge' });
fs.writeFileSync(out, buf);
console.log(`Wrote ${path.relative(process.cwd(), out)} (${buf.length} bytes)`);
