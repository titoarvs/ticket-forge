import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerStatus } from '../lib/claude.js';
import { extractText, SUPPORTED } from '../lib/parse.js';
import { generateProject, ticketAction, newTicket, regroupEpics } from '../lib/generate.js';
import * as store from '../lib/store.js';
import * as auth from '../lib/auth.js';
import { HttpError } from '../lib/auth.js';
import { migrate, dbInfo } from '../lib/db.js';
import { PERMISSIONS } from '../lib/permissions.js';
import { toCsvTickets, toCsvTestCases, toCsvJira, toXlsx, toDocx, toPdf, toHtml, slug } from '../lib/exporters.js';
import { assignKeys } from '../lib/model.js';
import { prInfo } from '../lib/github.js';
import { engineStatus, installBrowser, runAutomation, RUN_DIR } from '../lib/automation.js';

await migrate();
await auth.seedRoles();
const imported = await store.importJsonProjects();

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '50mb' }));

// cookies
app.use((req, _res, next) => {
  req.cookies = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) req.cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  next();
});
// Block cross-site writes (the session cookie is SameSite=Lax; this closes the remaining gap).
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) { try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Cross-site request blocked' }); } catch { return res.status(403).json({ error: 'Bad origin' }); } }
  next();
});
// session
app.use(async (req, _res, next) => {
  try { req.user = await auth.sessionUser(req.cookies[auth.SESSION_COOKIE]); } catch { req.user = null; }
  next();
});
app.use(express.static(path.join(here, 'public')));
app.use('/runs', (req, res, next) => (req.user ? next() : res.status(401).end()), express.static(RUN_DIR));

const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  if (!err.status || err.status >= 500) console.error(err);
  if (res.headersSent) return res.end();
  res.status(err.status || 500).json({ error: err.message || String(err) });
});
const aiOpts = (b) => ({ provider: b.provider || undefined, model: b.model || undefined });
const appUrl = (req) => (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
const secureCookie = () => /^https:/.test(process.env.APP_URL || '');
function setSession(res, { token, maxAge }) {
  res.setHeader('Set-Cookie', `${auth.SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookie() ? '; Secure' : ''}`);
}
const clearSession = (res) => res.setHeader('Set-Cookie', `${auth.SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
function authed(req) { if (!req.user) throw new HttpError(401, 'Sign in to continue.'); return req.user; }
function perm(req, ...perms) { const u = authed(req); perms.forEach((p) => store.requirePerm(u, p)); return u; }
function ndjson(res) {
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();
  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });
  const ping = setInterval(() => res.write('{"type":"ping"}\n'), 15000);
  return { send: (o) => { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n'); }, signal: ctrl.signal, end: () => { clearInterval(ping); res.end(); } };
}

// ---------------------------------------------------------------- auth
app.get('/api/auth/me', wrap(async (req, res) => res.json({
  user: auth.publicUser(req.user),
  setupRequired: (await auth.userCount()) === 0,
  permissions: PERMISSIONS,
  emailConfigured: auth.emailConfig().configured,
  database: dbInfo.label,
})));

app.post('/api/auth/setup', wrap(async (req, res) => {
  const u = await auth.createOwner(req.body);
  setSession(res, await auth.createSession(u.id, req.headers['user-agent']));
  res.json({ user: auth.publicUser(u) });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  auth.throttle(`login:${req.ip}:${auth.normEmail(req.body.email)}`);
  const u = await auth.login(req.body.email, req.body.password);
  setSession(res, await auth.createSession(u.id, req.headers['user-agent']));
  res.json({ user: auth.publicUser(u) });
}));

app.post('/api/auth/logout', wrap(async (req, res) => {
  await auth.destroySession(req.cookies[auth.SESSION_COOKIE]);
  clearSession(res);
  res.json({ ok: true });
}));

app.post('/api/auth/forgot', wrap(async (req, res) => {
  auth.throttle(`forgot:${req.ip}`, 5);
  const u = await auth.userByEmail(req.body.email);
  if (u && u.status === 'active') {
    const t = await auth.createReset(u.id);
    const url = `${appUrl(req)}/#/reset/${t}`;
    const mail = auth.emailLayout({ heading: 'Reset your password', intro: `Hi ${u.name},\n\nSomeone asked to reset the password for your TicketForge account (${u.email}).`, button: 'Choose a new password', url, note: 'This link works once and expires in 2 hours. If you did not ask for this, you can ignore this email.' });
    await auth.sendMail({ to: u.email, subject: 'Reset your TicketForge password', ...mail });
  }
  res.json({ ok: true, emailConfigured: auth.emailConfig().configured });
}));

app.post('/api/auth/reset', wrap(async (req, res) => {
  const u = await auth.resetPassword(req.body.token, req.body.password);
  setSession(res, await auth.createSession(u.id, req.headers['user-agent']));
  res.json({ user: auth.publicUser(u) });
}));

app.post('/api/auth/password', wrap(async (req, res) => {
  await auth.changePassword(authed(req), req.body.current, req.body.next);
  res.json({ ok: true });
}));

app.get('/api/invites/:token', wrap(async (req, res) => res.json(await auth.inviteInfo(req.params.token))));
app.post('/api/invites/:token/accept', wrap(async (req, res) => {
  const u = await auth.acceptInvite(req.params.token, req.body);
  setSession(res, await auth.createSession(u.id, req.headers['user-agent']));
  res.json({ user: auth.publicUser(u) });
}));

// ---------------------------------------------------------------- administration
async function sendInviteEmail(req, inv) {
  const link = `${appUrl(req)}/#/invite/${inv.token}`;
  const r = req.body.message ? `\n\n“${String(req.body.message).slice(0, 1000)}”` : '';
  const mail = auth.emailLayout({
    heading: `${req.user.name} invited you to TicketForge`,
    intro: `You've been invited to join TicketForge, where your team plans epics, issues, sprints and tests.${r}`,
    button: 'Accept invite', url: link, note: 'This invite link works once and expires in 7 days.',
  });
  const sent = await auth.sendMail({ to: inv.email, subject: `${req.user.name} invited you to TicketForge`, ...mail });
  await auth.markEmailed(inv.id, sent.sent);
  return { email: inv.email, link, emailed: sent.sent, emailError: sent.sent ? undefined : sent.reason };
}

app.get('/api/admin/users', wrap(async (req, res) => { perm(req, 'users.manage'); res.json(await auth.listUsers()); }));
app.patch('/api/admin/users/:id', wrap(async (req, res) => { perm(req, 'users.manage'); res.json(await auth.updateUser(req.user, req.params.id, req.body)); }));
app.delete('/api/admin/users/:id', wrap(async (req, res) => { perm(req, 'users.manage'); await auth.deleteUser(req.user, req.params.id); res.json({ ok: true }); }));
app.post('/api/admin/users/:id/reset', wrap(async (req, res) => {
  perm(req, 'users.manage');
  const u = await auth.getUser(req.params.id);
  if (!u) throw new HttpError(404, 'User not found');
  const t = await auth.createReset(u.id);
  const link = `${appUrl(req)}/#/reset/${t}`;
  const mail = auth.emailLayout({ heading: 'Set a new password', intro: `Hi ${u.name},\n\n${req.user.name} sent you a link to set a new TicketForge password.`, button: 'Choose a new password', url: link, note: 'This link works once and expires in 2 hours.' });
  const sent = await auth.sendMail({ to: u.email, subject: 'Set a new TicketForge password', ...mail });
  res.json({ link, emailed: sent.sent, emailError: sent.sent ? undefined : sent.reason });
}));

app.get('/api/admin/roles', wrap(async (req, res) => { authed(req); res.json(await auth.listRoles()); }));
app.post('/api/admin/roles', wrap(async (req, res) => { perm(req, 'users.manage'); res.json({ id: await auth.saveRole({ ...req.body, id: undefined }) }); }));
app.put('/api/admin/roles/:id', wrap(async (req, res) => { perm(req, 'users.manage'); res.json({ id: await auth.saveRole({ ...req.body, id: req.params.id }) }); }));
app.delete('/api/admin/roles/:id', wrap(async (req, res) => { perm(req, 'users.manage'); await auth.deleteRole(req.params.id, req.query.replacement); res.json({ ok: true }); }));

app.get('/api/admin/invites', wrap(async (req, res) => { perm(req, 'users.manage'); res.json(await auth.listInvites()); }));
app.post('/api/admin/invites', wrap(async (req, res) => {
  perm(req, 'users.manage');
  const created = await auth.createInvites(req.user, req.body);
  const results = [];
  for (const inv of created) results.push(inv.error ? { email: inv.email, error: inv.error } : await sendInviteEmail(req, inv));
  res.json({ results, emailConfigured: auth.emailConfig().configured });
}));
app.post('/api/admin/invites/:id/resend', wrap(async (req, res) => {
  perm(req, 'users.manage');
  res.json(await sendInviteEmail(req, await auth.reissueInvite(req.params.id)));
}));
app.delete('/api/admin/invites/:id', wrap(async (req, res) => { perm(req, 'users.manage'); await auth.revokeInvite(req.params.id); res.json({ ok: true }); }));

app.get('/api/admin/email', wrap(async (req, res) => {
  perm(req, 'users.manage');
  const c = auth.emailConfig();
  res.json({ ...c, appUrl: appUrl(req), appUrlSet: Boolean(process.env.APP_URL), database: dbInfo.label });
}));
app.post('/api/admin/email/test', wrap(async (req, res) => {
  const u = perm(req, 'users.manage');
  const mail = auth.emailLayout({ heading: 'Email is working', intro: `Hi ${u.name},\n\nThis is a test email from TicketForge. Invites and password resets will be delivered like this.`, button: 'Open TicketForge', url: appUrl(req), note: 'Sent from Administration → Email.' });
  const r = await auth.sendMail({ to: u.email, subject: 'TicketForge test email', ...mail });
  if (!r.sent) throw new HttpError(400, `Could not send: ${r.reason}`);
  res.json({ ok: true, to: u.email });
}));
app.get('/api/admin/projects', wrap(async (req, res) => {
  perm(req, 'users.manage');
  res.json((await store.listProjects({ is_owner: true })).map(({ id, name, key }) => ({ id, name, key })));
}));

// ---------------------------------------------------------------- app
app.get('/api/status', wrap(async (req, res) => { authed(req); res.json({ ...(await providerStatus()), supported: SUPPORTED, database: dbInfo.label }); }));

app.post('/api/parse', upload.single('file'), wrap(async (req, res) => {
  perm(req, 'project.create');
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const text = await extractText(req.file.buffer, req.file.originalname);
  if (!text) return res.status(422).json({ error: 'No readable text found in this file (scanned PDFs need OCR first).' });
  res.json({ filename: req.file.originalname, text, chars: text.length, words: text.split(/\s+/).length });
}));

app.post('/api/generate', wrap(async (req, res) => {
  const user = perm(req, 'project.create', 'ai.use');
  const { text, sourceName, options = {} } = req.body;
  if (!text || text.trim().length < 20) return res.status(400).json({ error: 'The document is empty or too short.' });
  const s = ndjson(res);
  try {
    const project = await generateProject({ text, sourceName, signal: s.signal, options: { ...options, ...aiOpts(options) }, emit: (e) => s.send({ type: 'progress', ...e }) });
    const saved = await store.createProject(project, user);
    s.send({ type: 'done', project: saved });
  } catch (err) {
    if (!s.signal.aborted) s.send({ type: 'error', error: err.message || String(err) });
  } finally { s.end(); }
}));

function aiProject(req) {
  const u = perm(req, 'ai.use');
  if (req.body.project?.id) store.requireAccess(u, req.body.project.id);
  return u;
}
app.post('/api/ai/ticket', wrap(async (req, res) => {
  aiProject(req);
  const { action, ticket, project, instruction } = req.body;
  res.json(await ticketAction({ action, ticket, project, instruction, ai: aiOpts(req.body) }));
}));
app.post('/api/ai/new-ticket', wrap(async (req, res) => {
  aiProject(req);
  const { epicId, project, idea } = req.body;
  res.json(await newTicket({ epicId, project, idea, ai: aiOpts(req.body) }));
}));
app.post('/api/ai/regroup', wrap(async (req, res) => {
  aiProject(req);
  const { project, instruction } = req.body;
  res.json(await regroupEpics({ project, instruction, ai: aiOpts(req.body) }));
}));

app.get('/api/pr-info', wrap(async (req, res) => { perm(req, 'issue.edit'); res.json(await prInfo(req.query.url)); }));

app.get('/api/automation/status', wrap(async (req, res) => { authed(req); res.json(await engineStatus()); }));
app.post('/api/automation/install', wrap(async (req, res) => {
  perm(req, 'users.manage');
  const s = ndjson(res);
  try { await installBrowser((line) => s.send({ type: 'log', line })); s.send({ type: 'done' }); }
  catch (err) { s.send({ type: 'error', message: err.message }); }
  finally { s.end(); }
}));
app.post('/api/automation/run', wrap(async (req, res) => {
  const user = perm(req, 'test.run');
  const { items, baseUrl, regenerate, project } = req.body;
  if (project?.id) store.requireAccess(user, project.id);
  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) return res.status(400).json({ error: 'Set a base URL (http:// or https://) for the app under test.' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'No test cases to run.' });
  if ((regenerate || items.some((i) => !i.tc?.script?.trim())) && !store.has(user, 'ai.use')) {
    return res.status(403).json({ error: 'Some tests have no script yet, and writing scripts uses Claude, which your role does not allow (ai.use). Run tests that already have scripts, or ask an administrator.' });
  }
  const eng = await engineStatus();
  if (!eng.browser) return res.status(400).json({ error: 'The test browser is not installed yet. An administrator can install it from the Test automation page.' });
  const s = ndjson(res);
  try {
    await runAutomation({ items, baseUrl, regenerate, project, ai: aiOpts(req.body), emit: s.send, signal: s.signal });
    s.send({ type: 'done' });
  } catch (err) {
    if (!s.signal.aborted) s.send({ type: 'error', message: err.message || String(err) });
  } finally { s.end(); }
}));

// ---------------------------------------------------------------- projects
app.get('/api/projects', wrap(async (req, res) => res.json(await store.listProjects(authed(req)))));
app.post('/api/projects', wrap(async (req, res) => {
  const user = perm(req, 'project.create');
  const p = req.body;
  if (!p || !Array.isArray(p.tickets) || !Array.isArray(p.epics)) throw new HttpError(400, 'Not a TicketForge project');
  p.id = p.id && /^[\w-]{1,64}$/.test(p.id) ? p.id : auth.newId().slice(0, 8);
  res.json(await store.createProject(p, user));
}));
app.get('/api/projects/:id', wrap(async (req, res) => {
  store.requireAccess(authed(req), req.params.id);
  res.json(await store.getProject(req.params.id));
}));
app.get('/api/projects/:id/version', wrap(async (req, res) => {
  store.requireAccess(authed(req), req.params.id);
  res.json({ version: await store.projectVersion(req.params.id) });
}));
app.get('/api/projects/:id/people', wrap(async (req, res) => {
  store.requireAccess(authed(req), req.params.id);
  const users = (await auth.listUsers()).filter((u) => u.status === 'active' && store.canAccess({ is_owner: u.isOwner, project_access: u.projectAccess }, req.params.id));
  res.json(users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.roleName })));
}));
app.patch('/api/projects/:id', wrap(async (req, res) => {
  const user = authed(req);
  store.requireAccess(user, req.params.id);
  res.json(await store.patchProject(req.params.id, req.body, user));
}));
app.delete('/api/projects/:id', wrap(async (req, res) => {
  const user = perm(req, 'project.delete');
  store.requireAccess(user, req.params.id);
  await store.deleteProject(req.params.id);
  res.json({ ok: true });
}));

const EXPORTS = {
  csv: { ext: 'tickets.csv', type: 'text/csv; charset=utf-8', fn: toCsvTickets },
  'csv-tests': { ext: 'test-cases.csv', type: 'text/csv; charset=utf-8', fn: toCsvTestCases },
  'csv-jira': { ext: 'jira-import.csv', type: 'text/csv; charset=utf-8', fn: toCsvJira },
  xlsx: { ext: 'xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fn: toXlsx },
  docx: { ext: 'docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fn: toDocx },
  pdf: { ext: 'pdf', type: 'application/pdf', fn: toPdf },
  html: { ext: 'html', type: 'text/html; charset=utf-8', fn: toHtml },
  json: { ext: 'json', type: 'application/json', fn: (p) => JSON.stringify(p, null, 2) },
};
app.post('/api/export/:format', wrap(async (req, res) => {
  const user = perm(req, 'export');
  const ex = EXPORTS[req.params.format];
  if (!ex) return res.status(400).json({ error: 'Unknown export format' });
  if (req.body?.id) store.requireAccess(user, req.body.id);
  const project = assignKeys(req.body);
  const out = await ex.fn(project);
  res.setHeader('Content-Type', ex.type);
  res.setHeader('Content-Disposition', `attachment; filename="${slug(project.name)}.${ex.ext}"`);
  res.send(out);
}));

const PORT = Number(process.env.PORT) || 5173;
app.listen(PORT, async () => {
  const s = await providerStatus();
  const e = auth.emailConfig();
  console.log(`TicketForge running at http://localhost:${PORT}`);
  console.log(`Database: ${dbInfo.label}${imported ? ` · imported ${imported} project(s) from data/projects` : ''}`);
  console.log(`Email: ${e.configured ? `SMTP ${e.host}:${e.port}` : 'not configured (invites show a copyable link)'}`);
  console.log(`Claude provider: ${s.defaultProvider}${s.cli.available ? ` (${s.cli.version} at ${s.cli.path})` : ''}${s.api ? ' · API key detected' : ''}`);
  if (s.cli.outdated) console.warn('Warning: your Claude Code CLI is outdated and may not support current models. Run `claude update`.');
  if (!(await auth.userCount())) console.log(`First run: open http://localhost:${PORT} to create the owner account.`);
});
