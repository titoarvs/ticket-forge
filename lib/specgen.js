// Coding specs, AI part: asks which files and modules each ticket of an epic will touch, then writes one coding prompt
// per ticket (lib/specs.js). Works with any git remote: when the repository is on this computer its file list is shown
// to the AI, otherwise the Repository Profile (Project settings → Code & GitHub) is what it goes by.
import { askJson } from './claude.js';
import { localReader } from './codebase.js';
import { SERVERLESS, currentContext } from './db.js';
import { cleanTouches, specPrompt } from './specs.js';

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

/** Is a git remote or repository connected to the project (a folder, a GitHub repository or a cloned URL)? */
export const hasRemote = (project) => Boolean(project?.dev?.localPath || project?.dev?.repo || project?.dev?.source?.url);

/** The repository's file names, when it is on this computer (never file contents). */
async function repoFiles(project) {
  const dir = project.dev?.localPath;
  if (!dir || SERVERLESS || !currentContext().local) return [];
  try { return (await localReader(dir).list()).slice(0, 4000); } catch { return []; }
}

/**
 * One spec per top-level ticket of the epic: { ticketId, ticketKey, title, prompt, criteria, files, modules }.
 * Throws a 400 when no git remote is connected or the epic has no tickets.
 */
export async function generateSpecs({ project, epic, ai = {} }) {
  if (!hasRemote(project)) throw Object.assign(new Error('Connect a git remote first: Project settings → Code & GitHub.'), { status: 400 });
  const tickets = project.tickets.filter((t) => t.epicId === epic.id && !t.parentId);
  if (!tickets.length) throw Object.assign(new Error(`${epic.title} has no issues to write specs for.`), { status: 400 });
  const files = await repoFiles(project);
  const profile = String(project.dev?.repoProfile?.markdown || '').trim();
  const touches = new Map();
  for (let i = 0; i < tickets.length; i += 20) {
    const batch = tickets.slice(i, i + 20);
    const res = await askJson({ ...ai, task: 'repo', reasoning: 'fast',
      system: `You are a senior engineer planning work that several developers will code in parallel, one ticket each. For every ticket
say which repository files it will change or create, and which modules (a folder or logical area such as "lib/store" or "client/Versions") they belong to.
Use real paths from the file list when one is given, otherwise follow the repository profile's structure and naming. Be specific:
name the files the ticket really needs, not whole folders, and no more than 12 per ticket. When two tickets need the same file, list it for both.
Return JSON only: { "items": [ { "key": "PR-1", "files": [ { "path": "lib/store.js", "action": "modify|create", "why": "short reason" } ], "modules": ["lib/store"] } ] }`,
      prompt: `Project: ${project.name}
Feature (epic): ${epic.key || ''} ${epic.title}${epic.description ? ` — ${clip(epic.description, 800)}` : ''}
${profile ? `\nRepository profile:\n${profile.slice(0, 6000)}\n` : ''}${files.length ? `\nRepository files:\n${files.join('\n')}\n` : ''}
Tickets:
${batch.map((t) => `- ${t.key} [${t.type}${t.layer ? `, ${t.layer}` : ''}] ${t.title}${t.userStory ? ` | ${clip(t.userStory, 200)}` : ''}${t.description ? ` | ${clip(t.description, 400)}` : ''}${t.acceptanceCriteria?.length ? ` | AC: ${t.acceptanceCriteria.slice(0, 8).map((a) => clip(a, 160)).join(' / ')}` : ''}`).join('\n')}` });
    for (const it of res.items || []) touches.set(String(it.key), cleanTouches(it));
  }
  return tickets.map((t) => {
    const { files: f, modules } = touches.get(String(t.key)) || { files: [], modules: [] };
    const subtasks = project.tickets.filter((x) => x.parentId === t.id);
    return { ticketId: t.id, ticketKey: t.key || '', title: t.title, criteria: (t.acceptanceCriteria || []).filter(Boolean).map(String), files: f, modules,
      prompt: specPrompt({ project, epic, ticket: t, subtasks, files: f, modules }) };
  });
}
