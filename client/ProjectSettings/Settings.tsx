'use client';
import Link from 'next/link';
import { P, type Any, mutate, S, uid, can, setField, emit, saveUi } from '../core';
import { SetCard, Ico, I, Avatar } from '../ui';
import { canDeleteProject, openDeleteProject, ONLY_OWNERS } from '../DeleteProject';
import { CommitInput, Header } from '../views';
import { WorkflowSettings } from '../WorkflowEditor';
import { DevSettings } from '../DevCode';
import { AppContextSettings } from '../AppContext';
import { RepoSetupCard } from '../RepoSetup';
import { DatabaseSettings } from '../Database';
import { SECTIONS, Details } from './Details';

function People({ ed }: { ed: boolean }) {
  const p = P();
  const assigned = (name: string) => p.tickets.filter((t: Any) => t.assignee === name).length;
  const renameMember = (m: Any, val: string) =>
    mutate((pp) => {
      if (!val) return;
      for (const t of pp.tickets) {
        if (t.assignee === m.name) t.assignee = val;
        if (t.reporter === m.name) t.reporter = val;
      }
      m.name = val;
    });
  const others = p.members.filter((m: Any) => !S.people.some((u: Any) => u.name === m.name));
  const add = () =>
    mutate((pp) =>
      pp.members.push({ id: uid(), name: `Person ${pp.members.length + 1}`, email: '', role: '' }),
    );
  return (
    <>
      <SetCard
        id="members"
        title="Team members"
        desc="People with an account and access to this project. Invites, roles and project access are managed in Administration."
        right={
          can('users.manage') && (
            <Link className="btn sm" href="/admin/invites">
              <Ico svg={I.people} />
              Invite users
            </Link>
          )
        }
      >
        <div className="tbl-scroll">
          <table className="tbl set-tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th className="num">Assigned issues</th>
              </tr>
            </thead>
            <tbody>
              {S.people.map((u: Any) => (
                <tr key={u.id}>
                  <td>
                    <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                      <Avatar name={u.name} />
                      {u.name}
                      {u.id === S.user?.id && <span className="muted small">(you)</span>}
                    </span>
                  </td>
                  <td className="muted">{u.email}</td>
                  <td>
                    <span className="label-chip">{u.role}</span>
                  </td>
                  <td className="num">{assigned(u.name)}</td>
                </tr>
              ))}
              {!S.people.length && (
                <tr>
                  <td colSpan={4} className="muted">
                    No one with an account has access yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SetCard>

      <SetCard
        id="no-account"
        title="People without an account"
        desc="Contractors, clients or anyone else you want to assign issues to. They can’t sign in."
        right={
          ed && (
            <button className="btn sm" onClick={add}>
              <Ico svg={I.plus} />
              Add person
            </button>
          )
        }
      >
        {others.length ? (
          <div className="tbl-scroll">
            <table className="tbl set-tbl">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th className="num">Assigned issues</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {others.map((m: Any) => (
                  <tr key={m.id}>
                    <td>
                      <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                        <Avatar name={m.name} />
                        <CommitInput
                          disabled={!ed}
                          value={m.name}
                          aria-label="Name"
                          onCommit={(v) => renameMember(m, v)}
                        />
                      </span>
                    </td>
                    <td>
                      <CommitInput
                        disabled={!ed}
                        value={m.email || ''}
                        placeholder="Optional"
                        aria-label="Email"
                        onCommit={(v) =>
                          mutate(() => {
                            m.email = v;
                          })
                        }
                      />
                    </td>
                    <td>
                      <CommitInput
                        disabled={!ed}
                        value={m.role || ''}
                        placeholder="e.g. Contractor"
                        aria-label="Role"
                        onCommit={(v) =>
                          mutate(() => {
                            m.role = v;
                          })
                        }
                      />
                    </td>
                    <td className="num">{assigned(m.name)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {ed && (
                        <button
                          className="icon-btn"
                          title="Remove"
                          aria-label={`Remove ${m.name}`}
                          onClick={() =>
                            mutate((pp) => {
                              pp.tickets.forEach((x: Any) => {
                                if (x.assignee === m.name) setField(x, 'assignee', '');
                              });
                              pp.members = pp.members.filter((x: Any) => x.id !== m.id);
                            })
                          }
                        >
                          <Ico svg={I.trash} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small set-empty">
            No one yet.
            {ed ? ' Add a person to assign them issues without giving them an account.' : ''}
          </p>
        )}
      </SetCard>
    </>
  );
}
function Danger() {
  const p = P();
  const allowed = canDeleteProject(p);
  const del = () =>
    openDeleteProject(p, () => {
      S.project = null;
      S.base = null;
      emit();
      S.nav('/projects');
    });
  return (
    <SetCard
      id="delete"
      tone="danger"
      title="Delete this project"
      desc="Removes the project with all of its epics, issues, sprints, test cases, source documents and failure screenshots from everyone’s project list. Only the creator and owners can delete it."
      right={
        <span title={allowed ? undefined : ONLY_OWNERS}>
          <button
            className="btn danger"
            onClick={del}
            disabled={!allowed}
            aria-describedby={allowed ? undefined : 'delete-owner-only'}
          >
            <Ico svg={I.trash} />
            Delete project
          </button>
        </span>
      }
    >
      {!allowed && (
        <p id="delete-owner-only" className="muted small set-note">
          {ONLY_OWNERS}
        </p>
      )}
      <p className="muted small set-note">
        Want a copy first? Use <b>Export → Project backup (.json)</b>. You can import it again from
        the projects page.
      </p>
    </SetCard>
  );
}
export function Settings() {
  const ed = can('project.settings');
  // Sections with their own permission are hidden from people who don't have it.
  // Database: also for people who set up repositories, so they can add their own database there.
  const own: Record<string, string[]> = {
    code: ['project.repo'],
    database: ['project.database', 'project.repo'],
  };
  const sections = SECTIONS.filter(([k]) => !own[k] || own[k].some(can));
  const cur = sections.find(([k]) => k === S.setTab)?.[0] || 'details';
  const go = (k: string) => {
    S.setTab = k;
    saveUi();
    emit();
    document.querySelector('.view')?.scrollTo({ top: 0 });
  };
  const [, label, , desc] = sections.find(([k]) => k === cur)!;
  return (
    <>
      <Header
        title="Project settings"
        sub={
          <span className="muted small set-autosave">
            <Ico svg={I.check} />
            Changes save automatically
          </span>
        }
      />
      <div className="set-layout">
        <nav className="set-nav" aria-label="Settings sections">
          {sections.map(([k, l, icon, d]) => (
            <button
              key={k}
              className={`set-nav-item ${k === cur ? 'on' : ''} ${k === 'danger' ? 'danger' : ''}`}
              aria-current={k === cur ? 'page' : undefined}
              onClick={() => go(k)}
            >
              <Ico svg={(I as Any)[icon]} />
              <span>
                <b>{l}</b>
                <small>{d}</small>
              </span>
            </button>
          ))}
        </nav>
        <div className="set-main">
          <div className="set-section-h">
            <h2>{label}</h2>
            <p className="muted">{desc}.</p>
          </div>
          {!ed && !['danger', 'database'].includes(cur) && (
            <div className="warn-banner">
              <Ico svg={I.warn} />
              <span>
                You can view these settings. To change them, ask an administrator for the{' '}
                <b>Project settings</b> permission.
              </span>
            </div>
          )}
          {cur === 'details' && <Details ed={ed} />}
          {cur === 'people' && <People ed={ed} />}
          {cur === 'workflow' && <WorkflowSettings />}
          {cur === 'context' && <AppContextSettings ed={ed} />}
          {cur === 'code' && (
            <>
              <RepoSetupCard key={P().id} />
              <DevSettings ed={ed} />
            </>
          )}
          {cur === 'database' && <DatabaseSettings key={P().id} />}
          {cur === 'danger' && <Danger />}
        </div>
      </div>
    </>
  );
}
