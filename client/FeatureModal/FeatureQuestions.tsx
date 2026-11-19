'use client';
import { Modal } from '../ui';
import { useQuestions, QuestionsView } from '../Clarify';

/** Add feature, step 2: the AI's questions before it plans the work. */
export function FeatureQuestions({
  text,
  instructions,
  onBack,
  onGo,
}: {
  text: string;
  instructions: string;
  onBack: () => void;
  onGo: (answers: string) => void;
}) {
  const q = useQuestions(
    { kind: 'feature', subject: 'the epics and issues', text, instructions },
    () => onGo(''),
  );
  return (
    <Modal
      title="Add feature with AI"
      wide
      persistent
      left={
        <button className="btn subtle" onClick={onBack}>
          Back
        </button>
      }
      actions={[
        { label: q.err ? 'Continue without' : 'Skip questions', onClick: () => onGo('') },
        { label: q.continueLabel, kind: 'ai', disabled: !q.qs, onClick: () => onGo(q.text()) },
      ]}
    >
      <QuestionsView q={q} subject="the epics and issues" />
    </Modal>
  );
}
