import { api, authed } from '@/lib/server/http';
import * as store from '@/lib/store';
import { q } from '@/lib/db';
import { listJobs } from '@/lib/devagent';

// Every code job in your workspace's projects (the ones you can open): on this computer (in memory)
// and on GitHub Actions (code_jobs), newest first, with the project and issue they belong to. For
// the Code jobs page.
const LIVE = ['starting', 'queued', 'running'];
export const GET = api(async (req) => {
  const user = await authed();
  const only = new URL(req.url).searchParams.get('project'); // one project (the backlog's coding indicators)
  const projects: any[] = (await store.listProjects(user)).filter(
    (p: any) => !only || p.id === only,
  );
  const byId = new Map(projects.map((p) => [p.id, p]));
  const ids = projects.map((p) => p.id);
  const local = ids.flatMap((id) => listJobs(id).map((j: any) => ({ ...j, where: 'local' })));
  const rows = ids.length
    ? (
        await q(
          'select data from code_jobs where project_id = any($1) order by updated_at desc limit 300',
          [ids],
        )
      ).rows
    : [];
  const remote = rows
    .map((r: any) => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data))
    .filter((j: any) => j && j.status !== 'discarded')
    .map((j: any) => {
      const files = j.files || [];
      return {
        id: j.id,
        projectId: j.projectId,
        ticketId: j.ticketId,
        ticketKey: j.ticketKey,
        status: j.status,
        branch: j.branch,
        repo: j.repo,
        side: j.side || 'frontend',
        startedAt: j.startedAt,
        finishedAt: j.finishedAt,
        error: j.error,
        files,
        pr: j.pr || null,
        agentName: j.agentName,
        startedBy: j.startedBy,
        costUsd: j.costUsd || 0,
        last: j.log?.[j.log.length - 1]?.text || '',
        where: 'github',
        url: j.runs?.[j.runs.length - 1]?.url || null,
      };
    });
  const jobs = [...local, ...remote]
    .filter((j) => byId.has(j.projectId))
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  // Issue titles, in one query.
  const pairs = [...new Set(jobs.map((j) => `${j.projectId}\u0000${j.ticketId}`))].map((s) =>
    s.split('\u0000'),
  );
  const titles = new Map<string, string>();
  if (pairs.length) {
    const r = await q(
      `select i.project_id, i.id, coalesce(i.data->>'title', '') as title from issues i
      join unnest($1::text[], $2::text[]) as x(p, t) on i.project_id = x.p and i.id = x.t`,
      [pairs.map((p) => p[0]), pairs.map((p) => p[1])],
    );
    for (const row of r.rows) titles.set(`${row.project_id}\u0000${row.id}`, row.title);
  }
  return {
    jobs: jobs.map((j) => {
      const p = byId.get(j.projectId);
      return {
        ...j,
        projectName: p.name,
        projectKey: p.key,
        title: titles.get(`${j.projectId}\u0000${j.ticketId}`) || '',
        live: LIVE.includes(j.status),
      };
    }),
    projects: projects.length,
  };
});
