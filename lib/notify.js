// In-app notifications and the "automated test failed" report.
import { q } from './db.js';
import { newId, listUsers, sendMail, emailLayout } from './auth.js';
import { getProject, appendComment, canAccess } from './store.js';

const pad = (n) => String(n).padStart(2, '0');
const oneLine = (s, n = 220) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

export async function notify({ userId, projectId, issueId, kind, title, body, link }) {
  await q('insert into notifications (id, user_id, project_id, issue_id, kind, title, body, link) values ($1,$2,$3,$4,$5,$6,$7,$8)',
    [newId(), userId, projectId || null, issueId || null, kind, String(title).slice(0, 300), String(body || '').slice(0, 2000), link || '']);
}
export async function listNotifications(userId) {
  const { rows } = await q('select id, project_id, issue_id, kind, title, body, link, created_at, read_at from notifications where user_id = $1 order by created_at desc limit 50', [userId]);
  const unread = (await q('select count(*)::int n from notifications where user_id = $1 and read_at is null', [userId])).rows[0].n;
  return { items: rows, unread };
}
export async function markRead(userId, ids) {
  if (Array.isArray(ids) && ids.length) await q('update notifications set read_at = now() where user_id = $1 and id = any($2) and read_at is null', [userId, ids]);
  else await q('update notifications set read_at = now() where user_id = $1 and read_at is null', [userId]);
}

/**
 * After a test run: one automated comment per issue with failures, and a notification (in-app + email)
 * to each issue's assignee. failures: Map(issueId -> [{ tcId, result }]).
 */
export async function reportFailures({ projectId, failures, runner, baseUrl, appUrl }) {
  const out = { commented: [], notified: [], emailed: [], skipped: [] };
  if (!projectId || !failures.size) return out;
  const project = await getProject(projectId);
  const onFail = { comment: true, notify: true, ...(project.automation?.onFail || {}) };
  const users = (await listUsers()).filter((u) => u.status === 'active');
  const at = new Date().toISOString();

  for (const [issueId, list] of failures) {
    const t = project.tickets.find((x) => x.id === issueId);
    if (!t) continue;
    const link = `${appUrl}/p/${projectId}/backlog?issue=${encodeURIComponent(issueId)}`;
    const items = list.map(({ tcId, result }) => {
      const i = t.testCases.findIndex((x) => x.id === tcId);
      const tc = t.testCases[i] || {};
      return {
        tcId, key: `TC-${t.key}-${pad(i + 1)}`, title: tc.title || 'Test case', error: oneLine(result.error, 400),
        screenshot: result.screenshot || null, durationMs: result.durationMs || 0,
      };
    });
    const who = t.assignee ? `@${t.assignee} ` : '';
    const n = items.length;
    const body = `${who}${n} automated test${n > 1 ? 's' : ''} failed in a run by ${runner.name} against ${baseUrl}:\n`
      + items.map((f) => `• ${f.key} ${f.title}\n  ${f.error || 'Failed'}`).join('\n');

    if (onFail.comment) {
      await appendComment(projectId, issueId, { id: newId().slice(0, 8), author: 'Automation', authorId: null, system: 'automation', at, body, failures: items, runBy: runner.name, baseUrl });
      out.commented.push(t.key);
    }
    if (!onFail.notify || !t.assignee) { if (!t.assignee) out.skipped.push(`${t.key} (unassigned)`); continue; }

    const name = t.assignee.trim().toLowerCase();
    const user = users.find((u) => u.name.trim().toLowerCase() === name && canAccess({ is_owner: u.isOwner, project_access: u.projectAccess }, projectId));
    const email = user?.email || (project.members || []).find((m) => m.name.trim().toLowerCase() === name)?.email;
    const title = `${n} automated test${n > 1 ? 's' : ''} failed on ${t.key}`;
    if (user) {
      await notify({ userId: user.id, projectId, issueId, kind: 'test-failed', title, body: `${t.title} — ${items.map((f) => f.key).join(', ')}`, link: `/p/${projectId}/backlog?issue=${encodeURIComponent(issueId)}` });
      out.notified.push(user.name);
    }
    if (email) {
      const mail = emailLayout({
        heading: `${title}: ${t.title}`,
        intro: `Hi ${t.assignee},\n\nAn automated test run by ${runner.name} against ${baseUrl} found failures on ${t.key}, which is assigned to you:\n\n`
          + items.map((f) => `• ${f.key} ${f.title}\n  ${f.error || 'Failed'}`).join('\n\n'),
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
