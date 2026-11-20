// TF-129: the spike's findings, the rules for setting an issue's layer (frontend, backend or both),
// are recorded in docs/ticket-layer-rules.md. Run with `npm test`. These tests check that the note
// covers each rule, the worked examples and the open questions, and that it uses the same values as
// the app (LAYERS in lib/layers.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const note = fs.readFileSync(path.join(root, 'docs/ticket-layer-rules.md'), 'utf8');
const section = (title: string) => {
  const start = note.indexOf(`## ${title}`);
  assert.ok(start >= 0, `missing section "${title}"`);
  const end = note.indexOf('\n## ', start + 3);
  return note.slice(start, end < 0 ? undefined : end);
};
/** The worked-example row whose first cell contains `text`. */
const example = (text: string) => {
  const row = section('Worked examples')
    .split('\n')
    .find((l) => l.startsWith('|') && l.split('|')[1]?.includes(text));
  assert.ok(row, `missing worked example "${text}"`);
  return row.split('|').at(-2)!.trim();
};

test('the note uses exactly the layer values the app uses', () => {
  const src = fs.readFileSync(path.join(root, 'lib/layers.ts'), 'utf8');
  const m = src.match(/export const LAYERS = \[([^\]]*)\]/);
  assert.ok(m, 'LAYERS not found in lib/layers.ts');
  const values = [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
  assert.deepEqual(values, ['frontend', 'backend', 'both']);
  for (const v of values)
    assert.match(note, new RegExp(`\\| \`${v}\` \\|`), `value ${v} not described`);
});

test('the decision rules cover frontend, backend and both, and pick exactly one value', () => {
  const rules = section('Decision rules');
  assert.match(rules, /left column[^\n]*\*\*frontend\*\*/i);
  assert.match(rules, /right column[^\n]*\*\*backend\*\*/i);
  assert.match(rules, /each column: \*\*both\*\*/i);
  assert.match(rules, /exactly one of these three values/i);
});

test('a user-interface-only ticket is classified as frontend', () => {
  assert.equal(example('layer chip in the issue list'), '**frontend**');
});

test('a server-only ticket is classified as backend', () => {
  assert.equal(example('Reject MCP issue creation'), '**backend**');
  assert.equal(example('Add an index'), '**backend**');
});

test('a ticket that changes UI and server is classified as both', () => {
  assert.equal(example('due-date field'), '**both**');
});

test('a ticket with no description is flagged for review, not given a layer silently', () => {
  const rule0 = section('Decision rules');
  assert.match(rule0, /Rule 0/);
  assert.match(rule0, /Leave Implementation as \*\*Not set\*\*/);
  assert.match(rule0, /Flag it for review and say why/);
  assert.match(rule0, /Don't guess the layer from the title/);
  const row = example('Fix login');
  assert.match(row, /Not set/);
  assert.match(row, /flagged/);
});

test('the note lists open questions', () => {
  const items = section('Open questions')
    .split('\n')
    .filter((l) => /^\d+\. /.test(l));
  assert.ok(items.length >= 3, `expected at least 3 open questions, found ${items.length}`);
});

test('the README links the note', () => {
  assert.match(
    fs.readFileSync(path.join(root, 'README.md'), 'utf8'),
    /\(docs\/ticket-layer-rules\.md\)/,
  );
});
