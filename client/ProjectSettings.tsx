'use client';
// Project settings, organised like Jira's: a section menu on the left (Details, People, Workflow, Danger zone),
// one section at a time, each made of labelled cards with a short explanation. Changes save automatically.
import Link from 'next/link';
import { S, emit, P, api, can, mutate, setField, openModal, toast, uid, ago, hashColor, COLORS, saveUi, type Any } from './core';
import { Ico, I, Avatar, Confirm, SetCard } from './ui';
import { TF, TA } from './fields';
import { Header, CommitInput } from './views';
import { ListEditor } from './ListEditor';
import { WorkflowSettings } from './WorkflowEditor';
import { DevSettings } from './DevCode';
import { AppContextSettings } from './AppContext';
import { allSources } from './Sources';
import { PsdTemplateCard } from './Psd';
import { ProjectFbdTemplateCard, ProjectArdTemplateCard } from './Fbd';

const SECTIONS: [string, string, string, string][] = [
  ['details', 'Details', 'settings', 'Name, key and what the project is about'],
  ['people', 'People', 'people', 'Who can be assigned issues'],
  ['workflow', 'Workflow', 'board', 'Statuses, board columns and transitions'],
  ['templates', 'Templates', 'doc', 'Problem Statement, Feature Brief and Architecture Record Design'],
  ['context', 'App context', 'sparkle', 'What the AI knows about this app, reused in every prompt'],
  ['code', 'Code & GitHub', 'pr', 'Repository, coding agent and pull requests'],
  ['danger', 'Danger zone', 'trash', 'Delete the project'],
];

function Details({ ed }: { ed: boolean }) {
  const p = P();
  const set = (k: string, v: Any) => mutate((pp) => { pp[k] = v; }, { tag: `p.${k}` });
  const rekey = (key: string) => mutate((pp) => {
    const old = pp.key;
    pp.key = key;
    for (const x of [...pp.tickets, ...pp.epics]) if (x.key?.startsWith(`${old}-`)) x.key = `${key}-${x.key.slice(old.length + 1)}`;
  });
  const issues = p.tickets.length, tests = p.tickets.reduce((n: number, t: Any) => n + t.testCases.length, 0);
  const docs = allSources(p).length;
  const stat = (n: number, label: string, href?: string) => {
    const body = <><b>{n.toLocaleString()}</b><span>{label}</span></>;
    return href ? <Link className="set-stat" href={`/p/${p.id}/${href}`}>{body}</Link> : <div className="set-stat">{body}</div>;
  };
  return <>
    <SetCard id="project" title="Project" desc="How the project appears in the project list and in issue keys.">
      <div className="set-identity">
        <span className="proj-avatar lg" style={{ background: hashColor(p.key, COLORS) }} aria-hidden>{p.key.slice(0, 2)}</span>
        <div className="set-fields">
          <label className="field"><span>Name</span><TF disabled={!ed} value={p.name} onChange={(e) => set('name', e.target.value)} /></label>
          <label className="field"><span>Key</span><CommitInput disabled={!ed} value={p.key} aria-describedby="key-help" onCommit={(v) => { const k = v.replace(/[^a-z0-9]/gi, '').toUpperCase(); if (k) rekey(k); }} />
            <small id="key-help" className="muted">Issues are numbered like <b>{p.key}-12</b>. Changing the key renames every issue and epic key.</small></label>
        </div>
      </div>
    </SetCard>

    <SetCard id="description" title="Project description" desc="What this project is, in your own words. Shown on the Summary page and given to the AI as context.">
      <TA disabled={!ed} value={p.description || ''} rows={4} placeholder="e.g. Tito Payroll: automated payroll for Tito Solutions PH, built on T201 and Tito Clock." onChange={(e) => set('description', e.target.value)} />
      {!p.description && p.summary && ed && <p className="muted small set-note">No description yet. <button className="link-btn" onClick={() => set('description', p.summary)}>Start from the initial feature’s summary</button> and edit it.</p>}
    </SetCard>

    <SetCard id="initial" title={p.sourceName ? <>Initial feature <span className="muted set-doc-name">· {p.sourceName}</span></> : 'Assumptions and open questions'}
      desc={p.sourceName ? 'What the AI read from the document this project was created from. Other documents keep their own on the Source documents page.' : 'Things the team assumes, and questions to raise with stakeholders.'}
      right={p.sourceText ? <Link className="btn sm" href={`/p/${p.id}/source`} onClick={() => { S.sourceDoc = 'original'; }}><Ico svg={I.doc} />Open document</Link> : null}>
      {p.sourceName && <label className="field"><span>Summary of the document</span><TA disabled={!ed} value={p.summary || ''} rows={4} onChange={(e) => set('summary', e.target.value)} /></label>}
      <div className="set-lists">
        <div><h4 className="set-sub">Assumptions <span className="count">{(p.assumptions || []).length}</span></h4>
          <ListEditor items={p.assumptions || []} disabled={!ed} noun="assumption" empty="No assumptions." onChange={(v) => set('assumptions', v)} /></div>
        <div><h4 className="set-sub">Open questions <span className="count">{(p.openQuestions || []).length}</span></h4>
          <ListEditor items={p.openQuestions || []} disabled={!ed} noun="question" empty="No open questions." onChange={(v) => set('openQuestions', v)} /></div>
      </div>
    </SetCard>

    {(p.sources || []).length > 0 && <SetCard id="more-docs" title="Other documents" desc="Features and documents added later. Each keeps its own summary and open questions."
      right={<Link className="btn sm" href={`/p/${p.id}/source`}>Source documents</Link>}>
      <ul className="set-docs">{p.sources.map((d: Any) => <li key={d.id}>
        <Link href={`/p/${p.id}/source`} onClick={() => { S.sourceDoc = d.id; }}><Ico svg={I.doc} /><b>{d.name}</b></Link>
        <span className="muted small">{(d.issueIds || []).length} issues · {(d.openQuestions || []).length} open questions{d.addedAt ? ` · added ${ago(d.addedAt)}` : ''}</span>
        {d.summary && <p className="small">{d.summary}</p>}
      </li>)}</ul>
    </SetCard>}

    <SetCard id="glance" title="At a glance" desc={p.createdAt ? <>Created {ago(p.createdAt)}{p.updatedAt ? <> · last changed {ago(p.updatedAt)}</> : null}</> : undefined}>
      <div className="set-stats">
        {stat(issues, issues === 1 ? 'issue' : 'issues', 'backlog')}
        {stat(p.epics.length, p.epics.length === 1 ? 'epic' : 'epics', 'epics')}
        {stat(p.sprints.length, p.sprints.length === 1 ? 'sprint' : 'sprints', 'backlog')}
        {stat(tests, tests === 1 ? 'test case' : 'test cases', 'tests')}
        {stat(docs, docs === 1 ? 'source document' : 'source documents', 'source')}
        {stat(p.workflow.length, 'statuses')}
      </div>
    </SetCard>
  </>;
}

function People({ ed }: { ed: boolean }) {
  const p = P();
  const assigned = (name: string) => p.tickets.filter((t: Any) => t.assignee === name).length;
  const renameMember = (m: Any, val: string) => mutate((pp) => {
    if (!val) return;
    for (const t of pp.tickets) { if (t.assignee === m.name) t.assignee = val; if (t.reporter === m.name) t.reporter = val; }
    m.name = val;
  });
  const others = p.members.filter((m: Any) => !S.people.some((u: Any) => u.name === m.name));
  const add = () => mutate((pp) => pp.members.push({ id: uid(), name: `Person ${pp.members.length + 1}`, email: '', role: '' }));
  return <>
    <SetCard id="members" title="Team members" desc="People with an account and access to this project. Invites, roles and project access are managed in Administration."
      right={can('users.manage') && <Link className="btn sm" href="/admin/invites"><Ico svg={I.people} />Invite users</Link>}>
      <div className="tbl-scroll"><table className="tbl set-tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th className="num">Assigned issues</th></tr></thead><tbody>
        {S.people.map((u: Any) => <tr key={u.id}>
          <td><span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><Avatar name={u.name} />{u.name}{u.id === S.user?.id && <span className="muted small">(you)</span>}</span></td>
          <td className="muted">{u.email}</td><td><span className="label-chip">{u.role}</span></td><td className="num">{assigned(u.name)}</td></tr>)}
        {!S.people.length && <tr><td colSpan={4} className="muted">No one with an account has access yet.</td></tr>}
      </tbody></table></div>
    </SetCard>

    <SetCard id="no-account" title="People without an account" desc="Contractors, clients or anyone else you want to assign issues to. They can’t sign in."
      right={ed && <button className="btn sm" onClick={add}><Ico svg={I.plus} />Add person</button>}>
      {others.length ? <div className="tbl-scroll"><table className="tbl set-tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th className="num">Assigned issues</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
        {others.map((m: Any) => (
          <tr key={m.id}>
            <td><span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><Avatar name={m.name} /><CommitInput disabled={!ed} value={m.name} aria-label="Name" onCommit={(v) => renameMember(m, v)} /></span></td>
            <td><CommitInput disabled={!ed} value={m.email || ''} placeholder="Optional" aria-label="Email" onCommit={(v) => mutate(() => { m.email = v; })} /></td>
            <td><CommitInput disabled={!ed} value={m.role || ''} placeholder="e.g. Contractor" aria-label="Role" onCommit={(v) => mutate(() => { m.role = v; })} /></td>
            <td className="num">{assigned(m.name)}</td>
            <td style={{ textAlign: 'right' }}>{ed && <button className="icon-btn" title="Remove" aria-label={`Remove ${m.name}`} onClick={() => mutate((pp) => { pp.tickets.forEach((x: Any) => { if (x.assignee === m.name) setField(x, 'assignee', ''); }); pp.members = pp.members.filter((x: Any) => x.id !== m.id); })}><Ico svg={I.trash} /></button>}</td></tr>
        ))}
      </tbody></table></div>
        : <p className="muted small set-empty">No one yet.{ed ? ' Add a person to assign them issues without giving them an account.' : ''}</p>}
    </SetCard>
  </>;
}

function Danger() {
  const p = P();
  const del = () => openModal(<Confirm title="Delete project?" label="Delete project" text={`“${p.name}” and all of its ${p.tickets.length} issues, ${p.epics.length} epics, sprints and test cases will be permanently deleted. This can’t be undone.`}
    onYes={async () => { try { await api(`/api/projects/${p.id}`, { method: 'DELETE' }); S.project = null; S.base = null; emit(); toast('Project deleted'); S.nav('/'); } catch (e: Any) { toast(e.message, 'err'); } }} />);
  return (
    <SetCard id="delete" tone="danger" title="Delete this project" desc="Permanently removes the project with all of its epics, issues, sprints, test cases, source documents and failure screenshots."
      right={<button className="btn danger" onClick={del}><Ico svg={I.trash} />Delete project</button>}>
      <p className="muted small set-note">Want a copy first? Use <b>Export → Project backup (.json)</b>. You can import it again from the projects page.</p>
    </SetCard>
  );
}

export function Settings() {
  const ed = can('project.settings');
  const sections = SECTIONS.filter(([k]) => k !== 'danger' || can('project.delete'));
  const cur = sections.find(([k]) => k === S.setTab)?.[0] || 'details';
  const go = (k: string) => { S.setTab = k; saveUi(); emit(); document.querySelector('.view')?.scrollTo({ top: 0 }); };
  const [, label, , desc] = sections.find(([k]) => k === cur)!;
  return <>
    <Header title="Project settings" sub={<span className="muted small set-autosave"><Ico svg={I.check} />Changes save automatically</span>} />
    <div className="set-layout">
      <nav className="set-nav" aria-label="Settings sections">
        {sections.map(([k, l, icon, d]) => (
          <button key={k} className={`set-nav-item ${k === cur ? 'on' : ''} ${k === 'danger' ? 'danger' : ''}`} aria-current={k === cur ? 'page' : undefined} onClick={() => go(k)}>
            <Ico svg={(I as Any)[icon]} /><span><b>{l}</b><small>{d}</small></span></button>
        ))}
      </nav>
      <div className="set-main">
        <div className="set-section-h"><h2>{label}</h2><p className="muted">{desc}.</p></div>
        {!ed && cur !== 'danger' && <div className="warn-banner"><Ico svg={I.warn} /><span>You can view these settings. To change them, ask an administrator for the <b>Project settings</b> permission.</span></div>}
        {cur === 'details' && <Details ed={ed} />}
        {cur === 'people' && <People ed={ed} />}
        {cur === 'workflow' && <WorkflowSettings />}
        {cur === 'templates' && <div className="set-templates">
          <p className="muted small" style={{ margin: '0 0 12px' }}>The templates this project’s documents follow. Without its own, a project uses the team’s templates from Administration → Generation. Documents already written don’t change.</p>
          <PsdTemplateCard project ed={ed} /><ProjectFbdTemplateCard ed={ed} /><ProjectArdTemplateCard ed={ed} /></div>}
        {cur === 'context' && <AppContextSettings ed={ed} />}
        {cur === 'code' && <DevSettings ed={ed} />}
        {cur === 'danger' && <Danger />}
      </div>
    </div>
  </>;
}
