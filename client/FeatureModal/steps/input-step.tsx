'use client';
// Step 1: describe the feature or import a document, and choose the issue size, test cases and
// extra instructions.
import { useRef } from 'react';
import { type Any, P } from '../../core';
import { Modal, Ico, I, Spinner } from '../../ui';
import { TA, SF, MenuItem, CB, TF } from '../../fields';
import type { Feature } from './use-feature';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function Intro({ includeTests }: { includeTests: boolean }) {
  const p = P();
  return (
    <p style={{ marginTop: 0 }}>
      Describe a new feature, or import a document. The AI plans epics and issues
      {includeTests ? ' with test cases' : ''} that fit <b>{p.name}</b>: it knows its{' '}
      {plural(p.epics.length, 'epic')} and {plural(p.tickets.length, 'issue')}, adds to existing
      epics where they fit and doesn’t repeat work. You review everything before it’s added.
    </p>
  );
}

function ModeTabs({ f }: { f: Feature }) {
  const tab = (m: 'describe' | 'document', label: string) => (
    <button
      role="tab"
      aria-selected={f.mode === m}
      className={f.mode === m ? 'on' : ''}
      onClick={() => f.setMode(m)}
    >
      {label}
    </button>
  );
  return (
    <div className="seg" role="tablist" style={{ marginBottom: 12 }}>
      {tab('describe', 'Describe it')}
      {tab('document', 'Import a document')}
    </div>
  );
}

function DocPicker({ f }: { f: Feature }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const choose = () => fileRef.current?.click();
  return (
    <div className="feat-doc">
      <input
        ref={fileRef}
        type="file"
        hidden
        accept=".pdf,.docx,.md,.markdown,.txt,.html,.htm,.csv,.json"
        onChange={(e) => {
          f.upload(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {f.doc ? (
        <div className="row" style={{ gap: 8 }}>
          <Ico svg={I.doc} />
          <b>{f.doc.filename}</b>
          <span className="muted small">
            {f.doc.text.split(/\s+/).length.toLocaleString()} words
          </span>
          <button className="btn sm subtle" onClick={choose}>
            Replace
          </button>
          <button className="btn sm subtle" onClick={() => f.setDoc(null)}>
            Remove
          </button>
        </div>
      ) : (
        <button className="btn" disabled={f.reading} onClick={choose}>
          {f.reading ? (
            <>
              <Spinner />
              Reading…
            </>
          ) : (
            <>
              <Ico svg={I.upload} />
              Choose a document
            </>
          )}
        </button>
      )}
      <p className="muted small" style={{ margin: '8px 0 0' }}>
        PDF, Word (.docx), Markdown, text or HTML: a spec, PRD or change request for the new work.
      </p>
    </div>
  );
}

function Options({ f }: { f: Feature }) {
  const { opts, setOpts, std } = f;
  const set = (patch: Any) => setOpts({ ...opts, ...patch });
  return (
    <>
      <div className="grid2" style={{ marginTop: 12 }}>
        <label className="field">
          <span>Issue size</span>
          <SF value={opts.granularity} onChange={(e) => set({ granularity: e.target.value })}>
            <MenuItem value="coarse">Fewer, larger issues</MenuItem>
            <MenuItem value="balanced">Balanced</MenuItem>
            <MenuItem value="fine">Many small issues</MenuItem>
          </SF>
        </label>
        <label className="field">
          <span>Test cases per issue{opts.testsPerTicket === std ? ' (team standard)' : ''}</span>
          <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
            <CB
              checked={opts.includeTests}
              onChange={(e: Any) => set({ includeTests: e.target.checked })}
              label=""
            />
            <TF
              type="number"
              disabled={!opts.includeTests}
              value={opts.testsPerTicket}
              slotProps={{ htmlInput: { min: 1, max: 15 } }}
              onChange={(e) => set({ testsPerTicket: Number(e.target.value) || std })}
            />
          </div>
        </label>
      </div>
      <label className="field">
        <span>Extra instructions (optional)</span>
        <TA
          style={{ minHeight: 44 }}
          value={opts.instructions}
          onChange={(e) => set({ instructions: e.target.value })}
          placeholder="e.g. Put everything in the Checkout epic. Label backend work api."
        />
      </label>
    </>
  );
}

export function InputStep({ f }: { f: Feature }) {
  return (
    <Modal
      title="Add feature with AI"
      wide
      actions={[
        { label: 'Cancel' },
        {
          label: '✨ Plan the work',
          kind: 'primary',
          disabled: !f.source || f.reading,
          onClick: f.next,
        },
      ]}
    >
      <Intro includeTests={f.opts.includeTests} />
      <ModeTabs f={f} />
      {f.mode === 'describe' ? (
        <label className="field">
          <span>What should the feature do?</span>
          <TA
            autoFocus
            style={{ minHeight: 120 }}
            value={f.text}
            onChange={(e) => f.setText(e.target.value)}
            placeholder={
              'e.g. Customers can save items to a wishlist, share it with a link, and get an email when a wishlist item goes on sale.'
            }
          />
        </label>
      ) : (
        <DocPicker f={f} />
      )}
      <Options f={f} />
    </Modal>
  );
}
