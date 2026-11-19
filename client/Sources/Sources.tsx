'use client';
// Source documents: the list on the left and the selected document on the right. This component
// only puts the parts in client/Sources/view/ together.
import { type Any, P, S, can, emit, openModal, ticket, epic } from '../core';
import { Ico, I, EmptyState } from '../ui';
import { Header } from '../views';
import { FeatureModal } from '../FeatureModal';
import { allSources, AddDocModal } from './all-sources';
import { useDocViewer } from './view/use-doc-viewer';
import { DocList } from './view/doc-list';
import { DocHead } from './view/doc-head';
import { DocWork } from './view/doc-work';
import { DocTools } from './view/doc-tools';
import { FileBar } from './view/file-bar';
import { DocBody } from './view/doc-body';

function AddDocButton() {
  return (
    <button className="btn primary" onClick={() => openModal(<AddDocModal />)}>
      <Ico svg={I.upload} />
      Add document
    </button>
  );
}

function SourcesHeader() {
  const canAdd = can('issue.create');
  return (
    <Header
      title="Source documents"
      right={
        <>
          {canAdd && can('ai.use') && (
            <button className="btn ai" onClick={() => openModal(<FeatureModal />)}>
              <Ico svg={I.plus} />
              Add feature with AI
            </button>
          )}
          {canAdd && <AddDocButton />}
        </>
      }
    />
  );
}

function NoDocuments() {
  return (
    <EmptyState
      icon={I.doc}
      tone="neutral"
      title="No source documents yet"
      actions={can('issue.create') && <AddDocButton />}
    >
      <p>
        This project was created without a requirements document. Documents you import with{' '}
        <b>Add feature with AI</b> or add here are kept on this page.
      </p>
    </EmptyState>
  );
}

export function Sources() {
  const docs = allSources(P());
  const sel = docs.find((d) => d.id === S.sourceDoc) || docs[0];
  const v = useDocViewer(sel);
  if (!sel)
    return (
      <>
        <SourcesHeader />
        <NoDocuments />
      </>
    );
  const canEdit = can('project.settings') || can('issue.create');
  const issues = (sel.issueIds || []).map(ticket).filter(Boolean) as Any[];
  const epics = (sel.epicIds || []).map(epic).filter(Boolean) as Any[];
  const select = (id: string) => {
    S.sourceDoc = id;
    v.reset();
    emit();
  };
  return (
    <>
      <SourcesHeader />
      <div className="src-layout">
        <DocList docs={docs} selId={sel.id} onSelect={select} />
        <section className="src-view">
          <DocHead sel={sel} canEdit={canEdit} issueCount={issues.length} />
          <DocWork sel={sel} issues={issues} epics={epics} />
          <DocTools v={v} />
          {v.mode === 'page' && <FileBar sel={sel} canEdit={canEdit} />}
          <DocBody sel={sel} v={v} />
        </section>
      </div>
    </>
  );
}
