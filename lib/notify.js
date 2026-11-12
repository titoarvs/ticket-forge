// In-app notifications and the "automated test failed" report.
import { q } from './db.js';
import { newId, listUsers, sendMail, emailLayout } from './auth.js';
import { getProject, appendComment, canAccess } from './store.js';
import { analysisText } from './failures.js';

const pad = (n) => String(n).padStart(2, '0');
const oneLine = (s, n = 220) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

export async function notify({ userId, projectId, issueId, kind, title, body, link }) {
  await q('insert into notifications (id, user_id, project_id, issue_id, kind, title, body, link) values ($1,$2,$3,$4,$5,$6,$7,$8)',
    [newId(), userId, projectId || null, issueId || null, kind, String(title).slice(0, 300), String(body || '').slice(0, 2000), link || '']);
}
export async function listNotifications(userId) {
  // One query (every open browser polls this): the latest 50 and, over all of the user's notifications, the unread count.
  const { rows } = await q(`select id, project_id, issue_id, kind, title, body, link, created_at, read_at,
      (count(*) filter (where read_at is null) over ())::int as unread_total
    from notifications where user_id = $1 order by created_at desc limit 50`, [userId]);
  const unread = rows[0]?.unread_total || 0;
  return { items: rows.map(({ unread_total: _u, ...r }) => r), unread };
}
export async function markRead(userId, ids) {
  if (Array.isArray(ids) && ids.length) await q('update notifications set read_at = now() where user_id = $1 and id = any($2) and read_at is null', [userId, ids]);
  else await q('update notifications set read_at = now() where user_id = $1 and read_at is null', [userId]);
}

/**
 * After a test run: one automated comment per issue with its results (passed and failed), and for failures a
 * notification (in-app + email) to the issue's assignee. results: Map(issueId -> [{ tcId, result }]).
 * Settings: automation.onFail { comment, notify } and automation.onPass { comment } (all on by default).
 */
export async function reportRun({ projectId, results, runner, baseUrl, appUrl, analyze = null, say = (_m) => {} }) {
  const out = { commented: [], notified: [], emailed: [], skipped: [], analyzed: 0 };
  if (!projectId || !results.size) return out;
  const project = await getProject(projectId);
  const onFail = { comment: true, notify: true, analyze: true, ...(project.automation?.onFail || {}) };
  const onPass = { comment: true, ...(project.automation?.onPass || {}) };
  const users = (await listUsers()).filter((u) => u.status === 'active');
  const at = new Date().toISOString();

  for (const [issueId, list] of results) {
    const t = project.tickets.find((x) => x.id === issueId);
    if (!t) continue;
    const link = `${appUrl}/p/${projectId}/backlog?issue=${encodeURIComponent(issueId)}`;
    const all = list.map(({ tcId, result }) => {
      const i = t.testCases.findIndex((x) => x.id === tcId);
      const tc = t.testCases[i] || {};
      const ok = result.status === 'Pass';
      return {
        tcId, key: `TC-${t.key}-${pad(i + 1)}`, title: tc.title || 'Test case', status: ok ? 'Pass' : 'Fail',
        error: ok ? '' : String(result.error || 'Failed').slice(0, 2000), screenshot: ok ? null : result.screenshot || null, durationMs: result.durationMs || 0, healed: result.healed ? { reason: result.healed.reason, error: result.healed.error } : null,
      };
    });
    const items = all.filter((x) => x.status !== 'Pass');
    const n = items.length, total = all.length;
    // AI failure analysis (light model tier): root cause, evidence and next steps for each failure.
    if (n && analyze && onFail.analyze && (onFail.comment || onFail.notify)) {
      say(`AI is analysing ${n} failure${n > 1 ? 's' : ''} on ${t.key}…`);
      const found = await analyze(issueId, list.filter(({ result }) => result.status !== 'Pass'));
      if (found?.error) say(`Couldn’t analyse the failures on ${t.key}: ${found.error}`);
      for (const f of items) { const a = found?.get(f.tcId); if (a) { f.analysis = a; out.analyzed++; } }
    }
    const who = n && t.assignee ? `@${t.assignee} ` : '';
    const body = n
      ? `${who}${n} of ${total} automated test${total > 1 ? 's' : ''} failed in a run by ${runner.name} against ${baseUrl}:\n`
        + items.map((f) => `• ${f.key} ${f.title}\n  ${oneLine(f.error, 400) || 'Failed'}${f.analysis ? `\n${analysisText(f.analysis)}` : ''}`).join('\n')
      : `All ${total} automated test${total > 1 ? 's' : ''} passed in a run by ${runner.name} against ${baseUrl}:\n` + all.map((f) => `• ${f.key} ${f.title}${f.healed ? ` (self-healed: ${f.healed.reason})` : ''}`).join('\n');

    if (n ? onFail.comment : onPass.comment) {
      await appendComment(projectId, issueId, {
        id: newId().slice(0, 8), author: 'Automation', authorId: null, system: 'automation', at, body,
        results: all, failures: items.map((f) => ({ ...f, error: oneLine(f.error, 400) })), passed: total - n, failed: n,
        durationMs: all.reduce((s, x) => s + (x.durationMs || 0), 0), runBy: runner.name, baseUrl,
      });
      out.commented.push(t.key);
    }
    if (!n) continue; // nothing failed: no one to notify
    if (!onFail.notify || !t.assignee) { if (!t.assignee) out.skipped.push(`${t.key} (unassigned)`); continue; }

    const name = t.assignee.trim().toLowerCase();
    const user = users.find((u) => u.name.trim().toLowerCase() === name && canAccess({ is_owner: u.isOwner, project_access: u.projectAccess }, projectId));
    const email = user?.email || (project.members || []).find((m) => m.name.trim().toLowerCase() === name)?.email;
    const title = `${n} automated test${n > 1 ? 's' : ''} failed on ${t.key}`;
    if (user) {
      const why = items.filter((f) => f.analysis).map((f) => `${f.key}: ${f.analysis.label} — ${f.analysis.summary}`).join(' · ');
      await notify({ userId: user.id, projectId, issueId, kind: 'test-failed', title, body: `${t.title} — ${why || items.map((f) => f.key).join(', ')}`, link: `/p/${projectId}/backlog?issue=${encodeURIComponent(issueId)}` });
      out.notified.push(user.name);
    }
    if (email) {
      const mail = emailLayout({
        heading: `${title}: ${t.title}`,
        intro: `Hi ${t.assignee},\n\nAn automated test run by ${runner.name} against ${baseUrl} found failures on ${t.key}, which is assigned to you:\n\n`
          + items.map((f) => `• ${f.key} ${f.title}\n  ${f.error || 'Failed'}${f.analysis ? `\n\n${analysisText(f.analysis)}` : ''}`).join('\n\n'),
        button: `Open ${t.key}`, url: link,
        note: `You're receiving this because you're the assignee of ${t.key} in ${project.name}.`,
      });
      const sent = await sendMail({ to: email, subject: `[${t.key}] ${title}`, ...mail });
      if (sent.sent) out.emailed.push(email);
    }
    if (!user && !email) out.skipped.push(`${t.key} (${t.assignee} has no account or email)`);
  }
  return out;
}
