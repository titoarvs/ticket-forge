'use client';

// Project workspace: the current view and the issue/epic panel.

import { useEffect } from 'react';
import { loadAgents, hireAgent } from './Agents';
import { useSearchParams, useRouter } from 'next/navigation';
import { useStore, openProject, P, S, emit, type Any, ticket, statusColorCss, feat } from './core';
import { WorkspaceSkeleton } from './skeletons';
import { RowPop } from './RowActions';
import { Drawer } from './Drawer';
import { openCode } from './DevCode';
import { watchCodeStatus, stopWatching } from './codeStatus';
import { VIEWS, COMPONENTS, VIEW_FEATURE } from './Workspace/view-list';
import { ProjectError, LockedView } from './Workspace/ProjectError';

export { VIEWS } from './Workspace/view-list';

export default function Workspace({ id, view }: { id: string; view: string }) {
  useStore();
  useEffect(() => {
    openProject(id);
  }, [id]);
  // Links from emails and notifications: /p/<id>/backlog?issue=<issueId> opens that issue.
  const params = useSearchParams();
  const router = useRouter();
  const issueParam = params.get('issue');
  const epicParam = params.get('epic');
  const hireParam = params.get('hire');
  const codeParam = params.get('code'); // from the Code jobs page: also open the issue's code job (frontend | backend)
  const loaded = P()?.id === id;
  // Changing page closes the issue/epic panel and any row popup, so the next page doesn't open with
  // the last page's issue beside it. (Runs before the ?issue / ?epic effects below, which may open
  // one for the new page.)
  useEffect(() => {
    if (S.drawer || S.full || S.pop) {
      Object.assign(S, { drawer: null, full: false, pop: null, menu: null });
      emit();
    }
  }, [view, id]);
  // From Administration → Agents → Hire: /p/<id>/backlog?epic=<epicId>&hire=<agentId> opens the
  // epic and hires the agent.
  useEffect(() => {
    if (!loaded || !epicParam) return;
    const ep = P().epics.find((x: Any) => x.id === epicParam);
    if (ep) {
      Object.assign(S, { drawer: { kind: 'epic', id: epicParam }, menu: null });
      emit();
      if (hireParam)
        loadAgents()
          .then((d) => {
            const a = d.agents.find((x: Any) => x.id === hireParam);
            if (a) hireAgent(a, ep);
          })
          .catch(() => {});
    }
    router.replace(`/p/${id}/${view || 'backlog'}`, { scroll: false });
  }, [loaded, epicParam, hireParam]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!loaded || !issueParam) return;
    const t = ticket(issueParam);
    if (t) {
      Object.assign(S, { drawer: { kind: 'issue', id: issueParam }, menu: null });
      emit();
      if (codeParam) openCode(t, codeParam === 'backend' ? 'backend' : 'frontend');
    }
    router.replace(`/p/${id}/${view || 'backlog'}`, { scroll: false });
  }, [loaded, issueParam]); // eslint-disable-line react-hooks/exhaustive-deps
  // Coding indicators on issues (rows, cards, the issue panel): fresh while this project is open.
  useEffect(() => {
    if (!loaded) return undefined;
    watchCodeStatus(id);
    return () => stopWatching();
  }, [loaded, id]);
  const v = VIEWS[view] ? view : 'backlog';
  if (S.projectError?.id === id)
    return (
      <div className="page">
        <ProjectError id={id} />
      </div>
    );
  if (!P() || P().id !== id) return <WorkspaceSkeleton view={v} />;
  const View = COMPONENTS[v];
  return (
    <div className="shell">
      <style>{statusColorCss()}</style>
      <div className="main">
        <section className="view">
          {feat(VIEW_FEATURE[v] || '') ? <View /> : <LockedView label={VIEWS[v]} />}
        </section>
        <Drawer />
      </div>
      <RowPop />
    </div>
  );
}
