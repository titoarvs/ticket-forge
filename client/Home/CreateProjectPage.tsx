'use client';
// Create a project from a document. This page only puts the parts in client/Home/create/ together.
import { useState, useEffect } from 'react';
import { Crumbs } from '../views';
import { useStore, S, closeProject, can, openModal } from '../core';
import { Ico, I } from '../ui';
import { BlankProjectModal } from '../actions';
import { useAutoTour } from '../tour';
import { generateProject } from './create/generate';
import { SourceInput } from './create/source-input';
import { GenOptions } from './create/options';
import { AiNotReady, GenProgress, HowItWorks } from './create/panels';

/**
 * Generate (when the role may use AI), and Cancel while it runs or "Create a blank project
 * instead".
 */
function Actions({ paste }: { paste: string }) {
  const g = S.gen;
  return (
    <div className="row">
      {can('ai.use') ? (
        <button
          className="btn primary"
          data-tour="new-generate"
          disabled={g?.running}
          onClick={() => generateProject(paste)}
        >
          <Ico svg={I.sparkle} />
          Generate backlog
        </button>
      ) : (
        <span className="muted small">Your role can’t use Claude to generate backlogs.</span>
      )}
      {g?.running ? (
        <button className="btn" onClick={() => g.ctrl.abort()}>
          Cancel
        </button>
      ) : (
        <button className="btn subtle" onClick={() => openModal(<BlankProjectModal />)}>
          Create a blank project instead
        </button>
      )}
    </div>
  );
}

export function CreateProjectPage() {
  useStore();
  const [paste, setPaste] = useState('');
  useEffect(() => {
    closeProject();
  }, []);
  useAutoTour('new');
  return (
    <div className="page">
      <div className="page-inner">
        <Crumbs>
          <span>Create project</span>
        </Crumbs>
        <div className="page-h">
          <h1>Create a project from a document</h1>
        </div>
        <div className="create-grid">
          <div>
            <AiNotReady />
            <SourceInput paste={paste} setPaste={setPaste} />
            <GenOptions />
            <Actions paste={paste} />
            {S.gen && <GenProgress g={S.gen} />}
          </div>
          <HowItWorks />
        </div>
      </div>
    </div>
  );
}
