// Open questions of the epic documents (PSD, FBD, ARD): found in the document, answered on the
// epic, and written back in by the AI. Run with `npm test`. No AI is called here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openQuestions, answeredNow, answersNote, questionId } from '../lib/doc-questions';

const FBD = `# Feature Brief for Checkout

## 1. Objective

Owner: [To confirm: who owns the release date]. Baseline is [To confirm: cart abandonment baseline].

## 8. Open Decisions

| ID | Question | Owner | Due | Status |
|----|----------|-------|-----|--------|
| Q01 | Which payment providers ship in v1? | Product | Sprint 4 | Open |
| Q02 | Do we keep guest checkout? | Product | Sprint 3 | Resolved: yes |
| Q03 | [Which release or policy decision is still open?] | [Owner] | [Date] | [Open] |

Again: [To confirm: who owns the release date].
`;

test('a Markdown document lists open decisions, then to-confirm points with where they are', () => {
  const qs = openQuestions('fbd', { markdown: FBD });
  assert.deepEqual(
    qs.map((q) => [q.code, q.text, q.section, q.line]),
    [
      [
        'Q01',
        'Which payment providers ship in v1?',
        '8. Open Decisions',
        'Owner, due, status: Product · Sprint 4 · Open',
      ],
      [
        '',
        'who owns the release date',
        '1. Objective',
        'Owner: ▢. Baseline is [cart abandonment baseline].',
      ],
      [
        '',
        'cart abandonment baseline',
        '1. Objective',
        'Owner: [who owns the release date]. Baseline is ▢.',
      ],
      ['', 'who owns the release date', '8. Open Decisions', 'Again: ▢.'],
    ],
  );
});

test('the same short point in different table rows stays separate questions', () => {
  const md =
    '## 7. Milestones\n\n| M1 | Pilot | [To confirm: date] |\n| M2 | Launch | [To confirm: date] |\n';
  const qs = openQuestions('fbd', { markdown: md });
  assert.deepEqual(
    qs.map((q) => q.line),
    ['M1 · Pilot · ▢', 'M2 · Launch · ▢'],
  );
  assert.notEqual(qs[0].id, qs[1].id);
});

test('resolved decisions and the template’s placeholder row are not open questions', () => {
  const texts = openQuestions('ard', { markdown: FBD }).map((q) => q.text);
  assert.ok(!texts.some((t) => /guest checkout/.test(t)));
  assert.ok(!texts.some((t) => /^\[/.test(t)));
});

test('a Problem Statement finds its markers in any field, but not in its answers', () => {
  const psd = {
    problemStatement: 'Carts are lost. [To validate with Sales: how many deals were affected]',
    evidence: [{ evidence: 'Logs', source: '[To confirm: who exports the logs]' }],
    answers: { x: '[To confirm: not a question]' },
  };
  assert.deepEqual(
    openQuestions('psd', psd).map((q) => q.text),
    ['how many deals were affected (to validate with Sales)', 'who exports the logs'],
  );
});

test('ids are stable, so an answer survives a rewrite that keeps the question', () => {
  assert.equal(questionId('Who owns it?'), questionId('  who OWNS   it? '));
  const doc = { markdown: FBD, answers: {} as Record<string, string> };
  const q = openQuestions('fbd', doc)[1];
  doc.answers[q.id] = 'The Product team';
  const again = {
    markdown: FBD.replace('# Feature Brief', '# Feature Brief v2'),
    answers: doc.answers,
  };
  assert.deepEqual(answeredNow('fbd', again), [
    {
      question:
        'who owns the release date (in “1. Objective”, the line “Owner: ▢. Baseline is [cart abandonment baseline].”)',
      answer: 'The Product team',
    },
  ]);
});

test('a rewrite is told every answer given so far', () => {
  const doc = {
    markdown: FBD,
    answers: { [openQuestions('fbd', { markdown: FBD })[0].id]: 'Stripe only' },
    resolved: [{ question: 'Who signs off?', answer: 'The CFO' }],
  };
  const note = answersNote('fbd', doc);
  assert.match(note, /Who signs off\?: The CFO/);
  assert.match(note, /Q01: Which payment providers ship in v1\?.*: Stripe only/);
  assert.equal(answersNote('fbd', { markdown: FBD }), '');
});

test('updating needs a document and at least one answer', async () => {
  const { answerOpenQuestions } = await import('../lib/doc-answers');
  const project = {
    id: 'p',
    name: 'Shop',
    epics: [{ id: 'e', title: 'Checkout', fbd: { markdown: FBD } }],
  };
  await assert.rejects(
    answerOpenQuestions({
      kind: 'fbd',
      project,
      epicId: 'e',
      answers: [{ question: 'x', answer: ' ' }],
    }),
    (e: any) => e.status === 400,
  );
  await assert.rejects(
    answerOpenQuestions({
      kind: 'ard',
      project,
      epicId: 'e',
      answers: [{ question: 'x', answer: 'y' }],
    }),
    (e: any) => e.status === 404,
  );
  await assert.rejects(
    answerOpenQuestions({ kind: 'nope', project, epicId: 'e', answers: [] }),
    (e: any) => e.status === 404,
  );
});
