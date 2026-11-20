'use client';
// Step 3: the AI planning the work, line by line, with Cancel (and Back after an error).
import { Modal, Ico, I, Spinner } from '../../ui';
import type { Feature, LogLine } from './use-feature';

function LineIcon({ l }: { l: LogLine }) {
  if (l.level === 'err' || l.level === 'warn') return <Ico svg={I.warn} />;
  if (l.done) return <Ico svg={I.check} className="ok" />;
  return <Spinner />;
}

export function RunningStep({ f }: { f: Feature }) {
  return (
    <Modal
      title="Add feature with AI"
      wide
      persistent
      actions={[{ label: 'Cancel', onClick: f.cancel }]}
    >
      <div className="progress-box">
        <div className="pbar">
          <i />
        </div>
        <ul className="log">
          {f.log.map((l, i) => (
            <li key={i} className={l.level || ''}>
              <LineIcon l={l} />
              <span>{l.message}</span>
            </li>
          ))}
        </ul>
        {f.chars > 0 && (
          <p className="muted small" style={{ margin: '6px 0 0' }}>
            Writing… {f.chars.toLocaleString()} characters so far
          </p>
        )}
        {f.log.some((l) => l.level === 'err') && (
          <button className="btn" style={{ marginTop: 10 }} onClick={() => f.setStep('input')}>
            Back
          </button>
        )}
      </div>
    </Modal>
  );
}
