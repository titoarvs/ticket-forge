// Builds the Ticket Forge problem statement Word document from its Markdown source.
// Usage: `npm run docs:problem-statement`. Reads docs/ticket-forge-problem-statement.md, writes docs/ticket-forge-problem-statement.docx.
import fs from 'node:fs';
import path from 'node:path';
import { markdownToDocx } from '../lib/md-docx';

const dir = path.join(import.meta.dirname, '..', 'docs');
const src = path.join(dir, 'ticket-forge-problem-statement.md');
const out = path.join(dir, 'ticket-forge-problem-statement.docx');

const buf = await markdownToDocx(fs.readFileSync(src, 'utf8'), { title: 'Ticket Forge: Problem Statement', creator: 'TicketForge' });
fs.writeFileSync(out, buf);
console.log(`Wrote ${path.relative(process.cwd(), out)} (${buf.length} bytes)`);
