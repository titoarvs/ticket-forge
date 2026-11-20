import { api, authed, body, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store';
import { SERVERLESS, currentContext } from '@/lib/db';
import { isSaas } from '@/lib/platform';
import * as brain from '@/lib/brain';

// The project brain (lib/brain.ts): its notes for the Brain page, one note, search, the zip of the
// vault, a preview of what the AI gets for an issue or epic; refresh, the team's own notes, import,
// and (on this computer only) folder sync.
// Reading needs access to the project. Writing your own notes needs Edit issues or Project
// settings; exporting needs Export; folder sync and the brain's settings need Project settings.
const localOnly = () => !SERVERLESS && !isSaas() && Boolean((currentContext() as any).local);
const canWrite = (u: any) => store.has(u, 'issue.edit') || store.has(u, 'project.settings');
const needWrite = (u: any) => {
  if (!canWrite(u))
    throw new HttpError(
      403,
      'Adding and changing notes needs the Edit issues or Project settings permission.',
    );
};
const MAX_IMPORT = 25 * 1024 * 1024;

export const GET = api(async (req, p) => {
  const user: any = await authed();
  store.requireAccess(user, p.id);
  const sp = new URL(req.url).searchParams;
  if (sp.get('note')) return brain.getNote(p.id, String(sp.get('note')));
  if (sp.get('search') !== null)
    return { ids: await brain.searchNotes(p.id, String(sp.get('search') || '').slice(0, 500)) };
  if (sp.get('export') === 'zip') {
    if (!store.has(user, 'export'))
      throw new HttpError(403, 'Downloading the brain needs the Export permission.');
    const project: any = await store.getProject(p.id);
    const z = await brain.exportZip(p.id, project.name);
    return new Response(new Uint8Array(z.data), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(z.name)}`,
        'Cache-Control': 'no-store',
      },
    });
  }
  // What the AI is given for a task about this issue or epic (the same block AI actions and code
  // jobs get).
  if (sp.get('context')) {
    const project: any = await store.getProject(p.id);
    const issue = project.tickets.find((t: any) => t.id === sp.get('issue'));
    const epic = (project.epics || []).find((e: any) => e.id === sp.get('epic'));
    if (!issue && !epic) throw new HttpError(400, 'Choose an issue or an epic.');
    return brain.brainPack({
      projectId: p.id,
      issues: issue ? [issue] : [],
      epics: epic ? [epic] : [],
      query: String(sp.get('q') || '').slice(0, 2000),
      preview: true,
    });
  }
  const list = await brain.listNotes(p.id);
  return {
    ...list,
    local: localOnly(),
    can: {
      write: canWrite(user),
      export: store.has(user, 'export'),
      settings: store.has(user, 'project.settings'),
    },
  };
});

export const POST = api(async (req, p) => {
  const user: any = await authed();
  store.requireAccess(user, p.id);
  // Import: .md files or a zip of an Obsidian vault, as a form upload.
  if ((req.headers.get('content-type') || '').startsWith('multipart/form-data')) {
    needWrite(user);
    const form = await req.formData();
    const files: { path: string; data: Buffer }[] = [];
    let size = 0;
    for (const f of form.getAll('file')) {
      if (typeof f === 'string') continue;
      size += f.size;
      if (size > MAX_IMPORT)
        throw new HttpError(413, 'That’s more than 25 MB. Import the vault in parts.');
      files.push({ path: (f as any).name || 'note.md', data: Buffer.from(await f.arrayBuffer()) });
    }
    if (!files.length) throw new HttpError(400, 'Choose .md files or a .zip of an Obsidian vault.');
    return brain.importNotes(p.id, files, user);
  }
  const b = await body(req);
  if (b.action === 'refresh') {
    const r = await brain.refreshBrain(p.id);
    return { ...r, ...(await brain.listNotes(p.id)) };
  }
  if (b.action === 'save') {
    needWrite(user);
    return brain.saveNote(p.id, b.note || {}, user);
  }
  if (b.action === 'delete') {
    needWrite(user);
    return brain.deleteNote(p.id, String(b.id || ''));
  }
  if (b.action === 'settings') {
    if (!store.has(user, 'project.settings'))
      throw new HttpError(
        403,
        'Changing the brain’s settings needs the Project settings permission.',
      );
    return brain.setSettings(p.id, b);
  }
  if (b.action === 'sync' || b.action === 'syncFolder') {
    if (!localOnly())
      throw new HttpError(
        400,
        'Syncing with a folder works only when TicketForge runs on your computer (opened at localhost).',
      );
    if (!store.has(user, 'project.settings'))
      throw new HttpError(403, 'Folder sync needs the Project settings permission.');
    if (b.action === 'syncFolder')
      return { sync: await brain.setSyncFolder(p.id, b.dir ? String(b.dir) : '') };
    const list: any = await brain.listNotes(p.id);
    const dir = String(b.dir || list.sync?.dir || '');
    return brain.syncFolder(p.id, dir, user);
  }
  throw new HttpError(400, 'Unknown action');
});
