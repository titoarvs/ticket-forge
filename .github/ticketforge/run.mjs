// TicketForge test runner for GitHub Actions (written by TicketForge; changes are overwritten on the next setup).
// Reads the encrypted run from TF_PAYLOAD, runs each Playwright script with the same runner TicketForge uses,
// and writes the encrypted results to out/results.bin for TicketForge to download. Only pass/fail lines are logged.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { runOne } from './run-one.mjs';

const key = Buffer.from(process.env.TF_KEY || '', 'base64');
if (key.length !== 32) { console.error('The TICKETFORGE_RUN_KEY secret is missing. Run the setup again from TicketForge (Test automation → Settings → GitHub Actions).'); process.exit(1); }
const open = (b64) => { const b = Buffer.from(b64, 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(b.subarray(28)), d.final()]))); };
const seal = (obj) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(zlib.gzipSync(Buffer.from(JSON.stringify(obj)))), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]); };

let job;
try { job = open(process.env.TF_PAYLOAD || ''); } catch { console.error('Couldn’t read the run: the TICKETFORGE_RUN_KEY secret doesn’t match TicketForge’s key. Run the setup again from TicketForge.'); process.exit(1); }
fs.mkdirSync('out', { recursive: true });
const results = [];
for (const t of job.tests) {
  let r, attempt = 0;
  do {
    attempt++;
    r = await runOne({ code: t.code, baseUrl: job.baseUrl, screenshotPath: path.resolve('out', t.tcId + '.jpg'), timeoutMs: job.timeoutMs, headless: true, app: job.app, browser: { kind: 'bundled' } });
  } while (r.status !== 'Pass' && attempt <= job.retries);
  console.log((r.status === 'Pass' ? '✓ ' : '✗ ') + t.label + ' (' + Math.round(r.durationMs / 1000) + 's' + (attempt > 1 ? ', ' + attempt + ' attempts' : '') + ')');
  const shot = r.status !== 'Pass' && r.screenshot && fs.existsSync(r.screenshot) ? fs.readFileSync(r.screenshot).toString('base64') : null;
  results.push({ tcId: t.tcId, ticketId: t.ticketId, status: r.status, error: r.error, durationMs: r.durationMs, logs: r.logs, page: r.page, attempts: attempt, flaky: r.status === 'Pass' && attempt > 1, shot });
}
fs.writeFileSync('out/results.bin', seal({ runId: job.runId, results, finishedAt: new Date().toISOString() }));
console.log(results.filter((x) => x.status === 'Pass').length + ' of ' + results.length + ' passed');
