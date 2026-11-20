// Builds the Ticket Forge overview and technical Word document from its Markdown source.
// Usage: `npm run docs:overview`. Reads docs/ticket-forge-overview-technical.md, writes
// docs/ticket-forge-overview-technical.docx.
import fs from 'node:fs';
import path from 'node:path';
import { markdownToDocx } from '../lib/md-docx';

const dir = path.join(import.meta.dirname, '..', 'docs');
const src = path.join(dir, 'ticket-forge-overview-technical.md');
const out = path.join(dir, 'ticket-forge-overview-technical.docx');

const buf = await markdownToDocx(fs.readFileSync(src, 'utf8'), {
  title: 'Ticket Forge: overview and technical document',
  creator: 'TicketForge',
});
fs.writeFileSync(out, buf);
console.log(`Wrote ${path.relative(process.cwd(), out)} (${buf.length} bytes)`);
