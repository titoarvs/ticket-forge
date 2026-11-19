'use client';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import {
  S,
  api,
  type Any,
  toast,
  emit,
  useStore,
  closeProject,
  uid,
  can,
  hashColor,
  COLORS,
  openModal,
} from '../core';
import { Ico, I, ErrorState, EmptyState } from '../ui';
import { ProjectsSkeleton } from '../skeletons';
import { BlankProjectModal } from '../actions';
import { TF } from '../fields';
import { openDeleteProject, canDeleteProject } from '../DeleteProject';
import { useAutoTour } from '../tour';
import { switchWorkspace } from '../WorkspaceSwitcher';

async function loadProjects() {
  try {
    S.projects = await api('/api/projects');
    S.projectsLoaded = true;
    S.projectsError = null;
  } catch (e: Any) {
    if (!S.projectsLoaded) S.projectsError = e;
    else toast(`Couldn’t refresh projects: ${e.message}`, 'err');
  }
  emit();
}
/** Your other workspaces with projects, so projects that are "missing" here are one click away. */
function OtherWorkspaces({ here }: { here: number }) {
  const others = (S.auth?.workspaces || []).filter(
    (w: Any) => w.id !== S.user?.workspaceId && w.projects > 0,
  );
  if (!others.length || here > 3) return null;
  return (
    <div className="ws-hint" role="note">
      <Ico svg={I.folder} />
      <span>
        Looking for other projects? They’re in your other workspace{others.length > 1 ? 's' : ''}:
      </span>
      {others.map((w: Any) => (
        <button key={w.id} className="btn sm" onClick={() => switchWorkspace(w.id)}>
          {w.name} · {w.projects} project{w.projects === 1 ? '' : 's'}
        </button>
      ))}
    </div>
  );
}
export function ProjectsPage() {
  useStore();
  const [q, setQ] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    closeProject();
    loadProjects();
  }, []);
  useAutoTour('home', Boolean(S.projectsLoaded));
  const list = S.projects.filter(
    (p: Any) => !q || `${p.name} ${p.key}`.toLowerCase().includes(q.toLowerCase()),
  );
  const importJson = async (file: File) => {
    try {
      const p = JSON.parse(await file.text());
      if (!Array.isArray(p.tickets) || !Array.isArray(p.epics))
        throw new Error('Not a TicketForge project file');
      p.id = uid();
      p.name = p.name || file.name.replace(/\.json$/, '');
      const saved = await api('/api/projects', { method: 'POST', body: p });
      S.nav(`/p/${saved.id}/summary`);
    } catch (e: Any) {
      toast(`Import failed: ${e.message}`, 'err');
    }
  };
  const del = (p: Any) => openDeleteProject(p, loadProjects);
  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-h">
          <div>
            <h1>Projects</h1>
            {(S.auth?.workspaces || []).length > 1 && (
              <p className="muted small" style={{ margin: '2px 0 0' }}>
                In <b>{S.user?.workspaceName}</b>
              </p>
            )}
          </div>
          <div className="spacer" />
          {can('project.create') && (
            <>
              <button className="btn" onClick={() => fileRef.current?.click()}>
                <Ico svg={I.upload} />
                Import backup
              </button>
              <input
                ref={fileRef}
                type="file"
                hidden
                accept=".json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importJson(f);
                }}
              />
              <Link className="btn primary" href="/new" data-tour="home-create">
                Create project
              </Link>
            </>
          )}
        </div>
        {S.projectsLoaded && <OtherWorkspaces here={S.projects.length} />}
        {!S.projectsLoaded ? (
          S.projectsError ? (
            <ErrorState
              title="Couldn’t load your projects"
              error={S.projectsError}
              onRetry={loadProjects}
            >
              <p>Check your connection and try again.</p>
            </ErrorState>
          ) : (
            <ProjectsSkeleton />
          )
        ) : S.projects.length ? (
          <>
            <div className="toolbar">
              <TF
                search
                sx={{ width: 220 }}
                placeholder="Search projects"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="col-key">Key</th>
                  <th className="num col-epics">Epics</th>
                  <th className="num">Issues</th>
                  <th>Last updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((p: Any) => (
                  <tr key={p.id} className="click" onClick={() => S.nav(`/p/${p.id}/summary`)}>
                    <td>
                      <span className="row" style={{ flexWrap: 'nowrap' }}>
                        <span
                          className="proj-avatar"
                          style={{
                            width: 24,
                            height: 24,
                            fontSize: 10,
                            background: hashColor(p.key, COLORS),
                          }}
                        >
                          {p.key.slice(0, 2)}
                        </span>
                        <a>{p.name}</a>
                      </span>
                    </td>
                    <td className="col-key">{p.key}</td>
                    <td className="num col-epics">{p.epics}</td>
                    <td className="num">{p.tickets}</td>
                    <td className="muted col-upd">
                      <span className="d-full">{new Date(p.updatedAt).toLocaleString()}</span>
                      <span className="d-short">
                        {new Date(p.updatedAt).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {canDeleteProject(p) && (
                        <button
                          className="icon-btn"
                          title="Delete project"
                          onClick={(e) => {
                            e.stopPropagation();
                            del(p);
                          }}
                        >
                          <Ico svg={I.trash} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!list.length && (
              <EmptyState
                compact
                icon={I.search}
                tone="neutral"
                title={<>No projects match “{q}”</>}
                actions={
                  <button className="btn" onClick={() => setQ('')}>
                    Clear search
                  </button>
                }
              >
                <p>Check the spelling or search by project key.</p>
              </EmptyState>
            )}
          </>
        ) : (
          <EmptyState
            icon={I.folder}
            title={can('project.create') ? 'Create your first project' : 'No projects yet'}
            actions={
              can('project.create') && (
                <>
                  <Link className="btn primary" href="/new" data-tour="home-create">
                    <Ico svg={I.sparkle} />
                    Create from a document
                  </Link>
                  <button className="btn" onClick={() => openModal(<BlankProjectModal />)}>
                    Blank project
                  </button>
                </>
              )
            }
          >
            <p>
              {can('project.create')
                ? 'Upload a requirements document and Claude turns it into epics, issues, acceptance criteria and test cases.'
                : 'You don’t have access to any projects yet. Ask an administrator to add you to one.'}
            </p>
          </EmptyState>
        )}
      </div>
    </div>
  );
}
// ---------------------------------------------------------------- create from a document
export function connLabel() {
  const st = S.status;
  if (!st) return { label: 'AI', model: '' };
  if (st.mode === 'account')
    return { label: 'your Claude account', model: S.settings.model || st.model || '' };
  return {
    label: st.api?.configured ? `${st.api.label} API` : 'AI (not set up)',
    model: st.model || '',
  };
}
