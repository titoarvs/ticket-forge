// The Problem Statement, Feature Brief and Architecture Record Design of an epic that doesn't exist yet: a feature being
// brainstormed in Add feature. The generators work on a project, so the draft epic is put in a copy of it (with the
// description or document it comes from as its source), and what the team decided in the brainstorm goes in as instructions.
import { generatePsd } from './psd';
import { generateFbd } from './fbd';
import { generateArd } from './ard';

export type FeatureDocKind = 'psd' | 'fbd' | 'ard';

/** A copy of the project with the draft epic in it. `epic` may already carry the documents written so far. */
export function withDraftEpic(project: any, epic: any, source?: { name?: string; text?: string }) {
  const e = { color: '#888', key: epic.key || 'NEW', ...epic };
  return {
    ...project,
    epics: [...(project.epics || []).filter((x: any) => x.id !== e.id), e],
    sources: [...(project.sources || []), ...(source?.text ? [{ id: `draft-${e.id}`, name: source.name || 'Feature description', text: source.text, epicIds: [e.id] }] : [])],
  };
}

export async function writeFeatureDoc({ project, kind, epic, source, digest = '', instructions = '', author = 'TicketForge', ai = {} }: any) {
  const tmp = withDraftEpic(project, epic, source);
  const text = [digest, String(instructions || '').trim() && `More instructions:\n${String(instructions).trim()}`].filter(Boolean).join('\n\n');
  const meta = { version: 'v1.0', status: 'Draft', date: new Date().toISOString().slice(0, 10), preparedBy: author };
  if (kind === 'psd') return { psd: await generatePsd({ project: tmp, epicId: epic.id, instructions: text, ai }) };
  if (kind === 'fbd') return { ...(await generateFbd({ project: tmp, epicId: epic.id, instructions: text, ai, meta })), meta };
  if (kind === 'ard') return { ...(await generateArd({ project: tmp, epicId: epic.id, instructions: text, ai, meta })), meta };
  throw Object.assign(new Error('Unknown document.'), { status: 400 });
}
