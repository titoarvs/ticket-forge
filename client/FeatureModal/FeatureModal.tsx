'use client';
// Add feature with AI: input → questions → the AI planning → review. This component only shows the
// step the modal is on; the steps are in client/FeatureModal/steps/.
import { P, closeModal } from '../core';
import { FeatureQuestions } from './FeatureQuestions';
import { type Source } from './steps/plan-request';
import { useFeature } from './steps/use-feature';
import { addWork } from './steps/add-work';
import { InputStep } from './steps/input-step';
import { RunningStep } from './steps/running-step';
import { ReviewStep } from './steps/review-step';

type FeatureModalProps = { initialDoc?: Source; sourceId?: string };

/** sourceId: plan more work from a source document already in the project ('original' or its id). */
export function FeatureModal({ initialDoc, sourceId }: FeatureModalProps = {}) {
  const f = useFeature(initialDoc);
  const add = () => {
    addWork({
      projectId: P().id,
      result: f.result,
      chosen: f.chosen,
      newEpics: f.newEpics,
      canEpic: f.canEpic,
      source: f.source,
      kind: f.mode === 'document' ? 'document' : 'description',
      sourceId,
    });
    closeModal();
  };
  if (f.step === 'ask' && f.source)
    return (
      <FeatureQuestions
        text={f.source.text}
        instructions={f.opts.instructions}
        onBack={() => f.setStep('input')}
        onGo={f.generate}
      />
    );
  if (f.step === 'running') return <RunningStep f={f} />;
  if (f.step === 'review' && f.result) return <ReviewStep f={f} onAdd={add} />;
  return <InputStep f={f} />;
}
