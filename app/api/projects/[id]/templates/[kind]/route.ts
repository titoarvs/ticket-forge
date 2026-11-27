import { api, authed, body, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store';
import {
  publicPsdTemplate,
  savePsdTemplate,
  clearPsdTemplate,
  getPsdTemplate,
} from '@/lib/psd-template';
import { publicFbdTemplate, saveFbdTemplate, resetFbdTemplate } from '@/lib/fbd';
import { publicArdTemplate, saveArdTemplate, resetArdTemplate } from '@/lib/ard';

// Project settings → Templates: a project's own Problem Statement (.docx), Feature Brief (.md) and Architecture Record
// Design (.md) templates. Without one, the project uses the team's (Administration → Generation).
const MD: Record<string, any> = {
  fbd: { get: publicFbdTemplate, save: saveFbdTemplate, reset: resetFbdTemplate },
  ard: { get: publicArdTemplate, save: saveArdTemplate, reset: resetArdTemplate },
};
const kindOf = (k: string) => {
  if (k !== 'psd' && !MD[k]) throw new HttpError(404, 'Unknown template.');
  return k;
};
async function guard(p: any, write = false) {
  const user = await authed();
  store.requireAccess(user, p.id);
  if (write && !store.has(user, 'project.settings'))
    throw new HttpError(
      403,
      'Changing the project’s templates needs the Project settings permission.',
    );
  return user;
}

export const GET = api(async (req, p) => {
  await guard(p);
  const kind = kindOf(p.kind);
  if (kind !== 'psd') return { template: await MD[kind].get(p.id) };
  if (!new URL(req.url).searchParams.get('download'))
    return { template: await publicPsdTemplate(p.id) };
  const t = await getPsdTemplate(p.id);
  if (!t) throw new HttpError(404, 'No template has been uploaded.');
  return new Response(t.data, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(t.name)}`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

export const PUT = api(async (req, p) => {
  const user = await guard(p, true);
  const kind = kindOf(p.kind);
  try {
    if (kind !== 'psd') {
      const b = await body(req);
      return { template: await MD[kind].save(user, b.text, b.name, p.id) };
    }
    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') throw new HttpError(400, 'No file uploaded');
    if (!/\.docx$/i.test(file.name)) throw new HttpError(415, 'Upload a Word document (.docx).');
    return {
      template: await savePsdTemplate(user, Buffer.from(await file.arrayBuffer()), file.name, p.id),
    };
  } catch (e: any) {
    throw e instanceof HttpError ? e : new HttpError(e.status || 500, e.message);
  }
});

export const DELETE = api(async (_req, p) => {
  await guard(p, true);
  const kind = kindOf(p.kind);
  if (kind !== 'psd') return { template: await MD[kind].reset(p.id) };
  await clearPsdTemplate(p.id);
  return { template: await publicPsdTemplate(p.id) };
});
