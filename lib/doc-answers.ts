// Updates an epic document with the team's answers to its open questions (lib/doc-questions.ts):
// each answered "[To confirm: …]" point is replaced by the answer, written into the document, and
// each answered open decision gets its decision and is marked Resolved. Everything else stays as
// it is. Nothing is saved here: the app stores the result on the epic.
import { askClaude, askJson } from './claude';
import { getRules } from './genrules';
import { contextBlock } from './appcontext';
import { sectionsOf } from './mdtemplate';
import { normalizePsd, PSD_SHAPE } from './psd';
import type { Answered } from './doc-questions';

const NAMES = { psd: 'Problem Statement', fbd: 'Feature Brief', ard: 'Architecture Record Design' };

const SYSTEM = (
  name: string,
) => `You are a senior analyst updating a ${name} with the team's answers to its open
questions. Change only what the answers settle:
- Replace each answered "[To confirm: …]" (or "[To validate …: …]") marker with the answer, written as a normal part of
  the sentence or table cell, in the document's own style. Don't leave the marker or mention that it was confirmed.
- For an answered open decision (Q01, Q02…), fill in the decision, set its status to Resolved, and update the places in
  the document that depend on it.
- When an answer changes other statements (a number, a role, a scope line), update those too, so the document agrees
  with itself.
- Keep every other word, heading, table, ID and unanswered [To confirm: …] marker exactly as it is.
- Never invent anything beyond the answers.`;

const clip = (s: string, n: number) => String(s || '').slice(0, n);

function answersBlock(answers: Answered[]) {
  return answers
    .map((a, i) => `${i + 1}. ${clip(a.question, 400)}\n   Answer: ${clip(a.answer, 1500)}`)
    .join('\n');
}

function cleanMarkdown(text: string) {
  let t = String(text || '').trim();
  const fence = t.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) t = fence[1];
  const start = t.search(/^#\s/m);
  if (start > 0) t = t.slice(start);
  return t.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

const notFound = (msg: string) => Object.assign(new Error(msg), { status: 404 });
const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });

/**
 * Returns the updated document: for a PSD `{ psd }` (its fields), for the FBD and ARD
 * `{ markdown }`. Throws when the AI drops sections, so a broken answer never replaces a document.
 */
export async function answerOpenQuestions({ kind, project, epicId, answers, ai = {} }: any) {
  const name = NAMES[kind];
  if (!name) throw notFound('Unknown document.');
  const epic = project.epics.find((e: any) => e.id === epicId);
  if (!epic) throw notFound('That epic isn’t in this project.');
  const doc = epic[kind];
  if (!doc || (kind !== 'psd' && !doc.markdown)) throw notFound(`This epic has no ${name} yet.`);
  const qa: Answered[] = (Array.isArray(answers) ? answers : [])
    .map((a: any) => ({
      question: String(a?.question || '').trim(),
      answer: String(a?.answer || '').trim(),
    }))
    .filter((a: Answered) => a.question && a.answer)
    .slice(0, 40);
  if (!qa.length) throw bad('Answer at least one open question first.');
  const rules = await getRules();
  const reasoning = rules.reasoning === 'fast' ? 'balanced' : rules.reasoning;
  const system = `${SYSTEM(name)}${contextBlock(project)}`;
  if (kind === 'psd') {
    const { answers: _a, resolved: _r, ...fields } = doc;
    const raw = await askJson({
      ...ai,
      task: 'docs',
      reasoning,
      system: `${system}\nOutput only JSON.`,
      prompt: `THE TEAM'S ANSWERS:\n${answersBlock(qa)}\n\nTHE PROBLEM STATEMENT (JSON):\n${JSON.stringify(fields)}\n\nReturn the whole updated Problem Statement as JSON exactly in this shape:\n${PSD_SHAPE}`,
    });
    return { psd: normalizePsd(raw, { project, epic }) };
  }
  const markdown = cleanMarkdown(
    await askClaude({
      ...ai,
      task: 'docs',
      reasoning,
      system: `${system}\nOutput only the whole updated Markdown document, nothing before or after it.`,
      prompt: `THE TEAM'S ANSWERS:\n${answersBlock(qa)}\n\nTHE ${name.toUpperCase()}:\n${doc.markdown}`,
    }),
  );
  const had = sectionsOf(doc.markdown);
  const have = new Set(sectionsOf(markdown));
  const lost = had.filter((s) => !have.has(s));
  if (lost.length > Math.max(1, had.length * 0.2))
    throw bad(
      `The AI returned an incomplete ${name} (missing: ${lost.slice(0, 5).join(', ')}). Nothing was changed; try again.`,
      502,
    );
  return { markdown };
}
