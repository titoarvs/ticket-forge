'use client';
// Administration → Agents: the TicketForge agents, one per job in the feature lifecycle, as cards. Details shows
// what an agent does, its inputs, output, tools and the exact prompt it runs with, and lets an administrator turn it
// off or change its model, effort and extra instructions. Hire picks a project and epic, opens the epic and puts the
// agent to work there.
import { useEffect, useState } from 'react';
import { S, toast, openModal, closeModal, ago, aiBody, can, type Any } from './core';
import { getAgents, saveAgents, agentsAction, deleteAgent } from './api/agents';
import { listProjects, getProject } from './api/projects';
import { Ico, I, Modal, Spinner, ErrorState, Loading, Sk, EmptyState } from './ui';
import { TA, TF, SF, CB, MenuItem } from './fields';
import { Markdown } from './GuideCard';
import { setAgentsCache, phaseClass } from './Agents';

const RUNNER: Record<string, string> = {
  code: 'Runs as a Claude Code agent in a git worktree',
  panel: 'Runs three Claude Code Review agents in parallel',
  generator: 'Runs TicketForge’s own writer with this agent’s instructions',
  document: 'Writes a Markdown document for the epic with Claude',
  testing: 'Runs inside Test automation: no hiring needed, turn it on or off here',
};

const KINDS: [string, string, string][] = [
  ['review', 'Review (read-only)', 'Reads the code and reports findings: reviews, audits, checks. Never edits.'],
  ['code', 'Code (edits)', 'Works on an issue in its own git worktree; you review the diff.'],
  ['document', 'Document', 'Writes a Markdown document for an epic.'],
];
const SAMPLE = `---
name: Migration Reviewer
description: Reviews database migrations for safety before they ship
runner: review
model: sonnet
icon: 🗄️
---
You are a database reviewer. Check every migration in the change.

## Do
- Flag destructive operations (DROP, column type changes, NOT NULL without default) with file:line.
- Check each migration has a working rollback.

## Don't
- Don't edit files.

## Output
A list of findings grouped Blocking / Should fix, each with file:line and the fix.`;

/** Ready-made agents to start from (besides the built-in ones). */
const REPO_BUILDER = `---
name: Repo-native Builder
description: Builds an issue the way this repository already builds features, using the project's profile and an existing feature as the pattern
runner: code
model: sonnet
effort: high
icon: 🧬
---
You are a senior engineer on this team. You implement one issue so the change looks like the rest of this codebase:
same structure, names, libraries, patterns and tests. You never invent a new way when the repository already has one.

## Before you write code
- Read the REPOSITORY PROFILE in your task (when there is one) and the issue, its sub-tasks and the epic.
- Find the closest existing feature to this one (Grep for similar routes, components, models or names) and read it
  end to end: entry point, API, service, data access, UI, tests. Name it in your plan: it is your pattern.
- Check the profile against the code: when they differ, the code wins; mention it in your summary.
- Plan with TodoWrite: one item per acceptance criterion, plus tests.

## While you build
- Put each file where the pattern feature put its equivalent; copy its naming, exports, imports and path aliases.
- Reuse the repository's components, hooks, helpers, validators, error types and API clients before writing new ones.
- Use the same data access, migrations, validation, permission checks and error handling as the pattern.
- Style UI with the existing design tokens and components; handle loading, empty, error and success states.
- Write tests in the repository's framework, next to where its tests live, in the same style as the pattern's tests.
- No new dependencies, configs or folders unless the issue truly needs them; say why if you add one.

## Before you finish
- Run the check command and fix what fails.
- Read your git diff as a reviewer: every acceptance criterion met, nothing unrelated changed, nothing generated edited.

## Output
A short summary: the pattern feature you followed (paths), what changed by file, how each acceptance criterion is met,
tests added and their result, and anything where you had to depart from the repository's usual way (and why).`;
const TEMPLATES: { id: string; label: string; md: string }[] = [
  { id: '__repo', label: '🧬 Repo-native Builder (builds from the repository and project)', md: REPO_BUILDER },
];

/** Create or edit a custom agent: describe it and the AI writes its rules, or paste / import a .md file. */
function CustomAgentModal({
  a,
  onSaved,
  builtIns = [],
  start = '',
}: {
  a?: Any;
  onSaved: (d: Any) => void;
  builtIns?: Any[];
  start?: string;
}) {
  const [mode, setMode] = useState(a ? 'md' : 'describe');
  const [desc, setDesc] = useState('');
  const [kind, setKind] = useState('review');
  const [md, setMd] = useState(a?.md || '');
  const [busy, setBusy] = useState('');
  const [check, setCheck] = useState<Any>(null);
  const run = async (k: string, fn: () => Promise<void>) => {
    setBusy(k);
    try {
      await fn();
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const generate = () =>
    run('gen', async () => {
      const r = await agentsAction(aiBody({ action: 'generate', description: desc, kind }));
      setMd(r.md);
      setMode('md');
      setCheck(null);
    });
  const verify = () =>
    run('check', async () => {
      setCheck((await agentsAction({ action: 'check', md })).agent);
    });
  const save = () =>
    run('save', async () => {
      const d = await agentsAction({ action: 'save', id: a?.id, md });
      onSaved(d);
      closeModal();
      toast(a ? `${a.name} updated` : 'Agent created');
    });
  const copyFrom = (id: string) => {
    if (!id) return;
    if (id === '__example') {
      setMd(SAMPLE);
      setMode('md');
      setCheck(null);
      return;
    }
    const tpl = TEMPLATES.find((x) => x.id === id);
    if (tpl) {
      setMd(tpl.md);
      setMode('md');
      setCheck(null);
      return;
    }
    run('copy', async () => {
      setMd((await agentsAction({ action: 'copy', id })).md);
      setMode('md');
      setCheck(null);
    });
  };
  useEffect(() => {
    if (start) copyFrom(start);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const file = (f?: File) => {
    if (f)
      f.text().then((t) => {
        setMd(t);
        setMode('md');
        setCheck(null);
      });
  };
  return (
    <Modal
      title={a ? `Edit ${a.name}` : 'Create an agent'}
      wide
      persistent
      actions={[
        { label: 'Cancel' },
        ...(mode === 'describe'
          ? [
              {
                label: busy === 'gen' ? 'Writing…' : 'Write its rules with AI',
                kind: 'ai' as const,
                disabled: !!busy || desc.trim().length < 10,
                onClick: generate,
              },
            ]
          : [
              { label: busy === 'check' ? 'Checking…' : 'Check', disabled: !!busy || !md.trim(), onClick: verify },
              {
                label: busy === 'save' ? 'Saving…' : a ? 'Save' : 'Create agent',
                kind: 'primary' as const,
                disabled: !!busy || !md.trim(),
                onClick: save,
              },
            ]),
      ]}
    >
      {!a && (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <div className="seg" role="tablist" aria-label="How">
            <button
              role="tab"
              aria-selected={mode === 'describe'}
              className={mode === 'describe' ? 'on' : ''}
              onClick={() => setMode('describe')}
            >
              Describe it
            </button>
            <button role="tab" aria-selected={mode === 'md'} className={mode === 'md' ? 'on' : ''} onClick={() => setMode('md')}>
              Markdown rules
            </button>
          </div>
          <SF filter value="" onChange={(e) => copyFrom(e.target.value)} aria-label="Start from">
            <MenuItem value="">{busy === 'copy' ? 'Copying…' : 'Start from a template…'}</MenuItem>
            {TEMPLATES.map((x) => (
              <MenuItem key={x.id} value={x.id}>
                {x.label}
              </MenuItem>
            ))}
            <MenuItem value="__example">Example: Migration Reviewer</MenuItem>
            {builtIns
              .filter((b: Any) => ['code'].includes(b.runner))
              .map((b: Any) => (
                <MenuItem key={b.id} value={b.id}>
                  {b.icon} {b.name}
                  {b.removed ? ' (removed built-in)' : ''}
                </MenuItem>
              ))}
          </SF>
        </div>
      )}
      {mode === 'describe' ? (
        <>
          <div className="upd-modes" role="radiogroup" aria-label="Kind">
            {KINDS.map(([k, l, d]) => (
              <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
                <b>{l}</b>
                <span className="muted small">{d}</span>
              </button>
            ))}
          </div>
          <label className="field" style={{ marginTop: 10 }}>
            <span>What should it do?</span>
            <TA
              rows={5}
              autoFocus
              value={desc}
              placeholder="e.g. Review every pull request for accessibility: labels on inputs, keyboard focus, colour contrast and alt text. Report each problem with file and line."
              onChange={(e) => setDesc(e.target.value)}
            />
          </label>
          <p className="muted small" style={{ margin: 0 }}>
            The AI writes the agent’s Markdown rules (name, runner, model, Do / Don’t / Output). You review and edit them before saving.
          </p>
        </>
      ) : (
        <>
          <p className="muted small" style={{ marginTop: 0 }}>
            Same format as Claude Code agent files: a frontmatter block (<code>name</code>, <code>description</code>, <code>runner</code>:
            code · review · document, optional <code>model</code> and <code>icon</code>), then the instructions.
            {!md && (
              <>
                {' '}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setMd(SAMPLE);
                  }}
                >
                  Start from an example
                </a>
                .
              </>
            )}{' '}
            <label className="link-btn">
              Import a .md file
              <input type="file" accept=".md,text/markdown,text/plain" hidden onChange={(e) => file(e.target.files?.[0])} />
            </label>
          </p>
          <TA
            mono
            rows={16}
            value={md}
            spellCheck={false}
            onChange={(e) => {
              setMd(e.target.value);
              setCheck(null);
            }}
            placeholder={SAMPLE}
          />
          {check && (
            <div className="ok-banner" style={{ marginTop: 8 }}>
              <Ico svg={I.check} />
              <span>
                <b>{check.name}</b> · {KINDS.find(([k]) => k === check.kind)?.[1]} · {check.model || 'sonnet'} — ready to save.
              </span>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function AgentDetails({
  a,
  data,
  onSave,
  onHire,
  onData,
}: {
  a: Any;
  data: Any;
  onSave: (id: string, v: Any) => Promise<void>;
  onHire: () => void;
  onData: (d: Any) => void;
}) {
  const [v, setV] = useState({ enabled: a.enabled, model: a.model || '', effort: a.effort || '', instructions: a.instructions || '' });
  const code = a.runner === 'code' || a.runner === 'panel';
  const dirty =
    v.enabled !== a.enabled ||
    (code && (v.model !== (a.model || '') || v.effort !== (a.effort || ''))) ||
    v.instructions !== a.instructions;
  return (
    <Modal
      title={a.name}
      wide
      left={
        !a.custom ? (
          <div className="row" style={{ gap: 6 }}>
            {a.runner === 'code' && (
              <button
                className="btn"
                onClick={() => openModal(<CustomAgentModal onSaved={onData} builtIns={data.builtIns} start={a.id} />)}
                title="A custom agent with this agent’s rules, for you to change"
              >
                Copy as custom agent
              </button>
            )}
            <button
              className="btn danger-subtle"
              onClick={async () => {
                try {
                  onData(await agentsAction({ action: 'remove', ids: [a.id] }));
                  closeModal();
                  toast(`${a.name} removed. Restore it from Built-in agents.`);
                } catch (e: Any) {
                  toast(e.message, 'err');
                }
              }}
            >
              Remove
            </button>
          </div>
        ) : a.custom ? (
          <div className="row" style={{ gap: 6 }}>
            <button className="btn" onClick={() => openModal(<CustomAgentModal a={a} onSaved={onData} />)}>
              Edit rules
            </button>
            <button
              className="btn danger-subtle"
              onClick={async () => {
                try {
                  onData(await deleteAgent(a.id));
                  closeModal();
                  toast(`${a.name} removed`);
                } catch (e: Any) {
                  toast(e.message, 'err');
                }
              }}
            >
              Remove
            </button>
          </div>
        ) : undefined
      }
      actions={[
        { label: 'Close' },
        { label: 'Hire', onClick: onHire, disabled: !a.enabled, hidden: a.runner === 'testing' },
        {
          label: 'Save',
          kind: 'primary',
          disabled: !dirty,
          onClick: async () => {
            await onSave(a.id, v);
            closeModal();
          },
        },
      ]}
    >
      <div className={`ad-hero ${phaseClass(a.phase)}`}>
        <span className="agent-icon lg" aria-hidden>
          {a.icon}
        </span>
        <div>
          <div className="ad-phase">{a.phase}</div>
          <p className="ad-sum">{a.summary}</p>
          <div className="agent-chips">
            <span className="agent-chip">{a.workspaceLabel}</span>
            {a.step && <span className="agent-chip step">{a.step}</span>}
          </div>
        </div>
      </div>
      <div className="ad-grid">
        <section>
          <h4>What it does</h4>
          <ul>
            {a.does.map((d: string) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </section>
        <section>
          <h4>Reads</h4>
          <ul>
            {a.inputs.map((x: string) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <h4>Produces</h4>
          <p>{a.output}</p>
          <h4>Where you hire it</h4>
          <p>{a.where}</p>
        </section>
      </div>
      <p className="ad-runner small">
        <Ico svg={I.bot} />
        {RUNNER[a.runner]}
      </p>
      {a.runner === 'code' && (
        <>
          <h4>Tools Claude Code allows it</h4>
          <div className="ad-tools">
            {a.tools.map((t: string) => (
              <code key={t}>{t}</code>
            ))}
          </div>
          <p className="muted small">
            {a.writes ? 'Edits files only in the issue’s worktree.' : 'Read-only: it never edits files.'} Plus the project’s check command,
            when one is set. It can never commit, push, switch branches or browse the web.
          </p>
          <details className="ad-prompt">
            <summary>Its system prompt</summary>
            <pre>{a.prompt}</pre>
          </details>
        </>
      )}
      {a.runner === 'document' && (
        <details className="ad-prompt">
          <summary>What it’s told</summary>
          <pre>{a.docPrompt}</pre>
        </details>
      )}
      {a.custom && (
        <details className="ad-prompt" open={Boolean(a.broken)}>
          <summary>Its Markdown rules{a.broken ? ' (needs fixing)' : ''}</summary>
          <div className="agent-doc small">
            <Markdown text={String(a.md || '').replace(/^---[\s\S]*?---/, '')} />
          </div>
        </details>
      )}
      <h4 className="ad-settings">Settings</h4>
      <CB label="Turned on (people can hire it)" checked={v.enabled} onChange={(e: Any) => setV({ ...v, enabled: e.target.checked })} />
      {code && (
        <div className="grid2">
          <label className="field">
            <span>Claude model</span>
            <SF value={v.model} onChange={(e) => setV({ ...v, model: e.target.value })}>
              {data.models.map((m: string) => (
                <MenuItem key={m} value={m}>
                  {m}
                  {m === a.defaults.model ? ' (default)' : ''}
                </MenuItem>
              ))}
            </SF>
            <small className="muted">A project’s own model (Project settings → Code & GitHub) wins for jobs in that project.</small>
          </label>
          <label className="field">
            <span>Effort</span>
            <SF value={v.effort} onChange={(e) => setV({ ...v, effort: e.target.value })}>
              {data.efforts.map((m: string) => (
                <MenuItem key={m} value={m}>
                  {m}
                  {m === a.defaults.effort ? ' (default)' : ''}
                </MenuItem>
              ))}
            </SF>
          </label>
        </div>
      )}
      <label className="field">
        <span>Extra instructions for this agent</span>
        <TA
          rows={4}
          value={v.instructions}
          placeholder={
            code
              ? 'e.g. Always add a Playwright test for UI changes. Never touch the billing module.'
              : 'e.g. Write for a non-technical audience. Use our release-note headings.'
          }
          onChange={(e) => setV({ ...v, instructions: e.target.value })}
        />
      </label>
    </Modal>
  );
}

/** Hire from Administration: choose the project and epic, then the epic opens with the agent at work. */
function HireModal({ a }: { a: Any }) {
  const [projects, setProjects] = useState<Any[] | null>(null);
  const [pid, setPid] = useState('');
  const [project, setProject] = useState<Any>(null);
  const [eid, setEid] = useState('');
  useEffect(() => {
    listProjects()
      .then((l) => {
        setProjects(l);
        if (l[0]) setPid(l[0].id);
      })
      .catch((e) => toast(e.message, 'err'));
  }, []);
  useEffect(() => {
    if (!pid) return;
    setProject(null);
    setEid('');
    getProject(pid)
      .then((p) => {
        setProject(p);
        if (p.epics?.[0]) setEid(p.epics[0].id);
      })
      .catch((e) => toast(e.message, 'err'));
  }, [pid]);
  const go = () => {
    closeModal();
    S.nav(`/p/${pid}/backlog?epic=${encodeURIComponent(eid)}&hire=${encodeURIComponent(a.id)}`);
  };
  return (
    <Modal
      title={`Hire ${a.name}`}
      actions={[{ label: 'Cancel' }, { label: 'Hire', kind: 'primary', disabled: !pid || !eid, onClick: go }]}
    >
      <div className="hire-intro">
        <span className="agent-icon" aria-hidden>
          {a.icon}
        </span>
        <div>
          <b>{a.summary}</b>
          <div className="muted small">{a.where}</div>
        </div>
      </div>
      {!projects ? (
        <div className="muted">
          <Spinner /> Loading projects…
        </div>
      ) : !projects.length ? (
        <p className="muted">There are no projects yet.</p>
      ) : (
        <>
          <label className="field">
            <span>Project</span>
            <SF value={pid} onChange={(e) => setPid(e.target.value)}>
              {projects.map((p: Any) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name}
                </MenuItem>
              ))}
            </SF>
          </label>
          <label className="field">
            <span>Feature (epic)</span>
            {!project ? (
              <div className="muted small">
                <Spinner /> Loading epics…
              </div>
            ) : project.epics?.length ? (
              <SF value={eid} onChange={(e) => setEid(e.target.value)}>
                {project.epics.map((e: Any) => (
                  <MenuItem key={e.id} value={e.id}>
                    {e.key ? `${e.key} · ` : ''}
                    {e.title}
                  </MenuItem>
                ))}
              </SF>
            ) : (
              <span className="muted small">This project has no epics yet.</span>
            )}
          </label>
          <p className="muted small" style={{ marginBottom: 0 }}>
            The epic opens with its <b>Agents</b> section, and{' '}
            {a.runner === 'code' || a.runner === 'panel' ? 'you pick the issue for the agent to work on.' : 'the agent starts there.'}
          </p>
        </>
      )}
    </Modal>
  );
}

/** On/off switch for an agent, right on its card or row. */
function Toggle({ a, onChange, busy }: { a: Any; onChange: (on: boolean) => void; busy: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={a.enabled}
      aria-label={`${a.name}: ${a.enabled ? 'on' : 'off'}`}
      title={a.enabled ? 'On: people can hire it. Click to turn off.' : 'Off. Click to turn on.'}
      className={`ag-switch ${a.enabled ? 'on' : ''}`}
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!a.enabled);
      }}
    >
      <i />
    </button>
  );
}
const modelOf = (a: Any) => (a.runner === 'code' || a.runner === 'panel' ? a.model || a.defaults?.model || '' : '');

/** One agent card: what it does, where it runs, its model, an on/off switch, Details and Hire. */
function Card({
  a,
  onDetails,
  onHire,
  onToggle,
  busy,
}: {
  a: Any;
  onDetails: () => void;
  onHire?: () => void;
  onToggle: (on: boolean) => void;
  busy: boolean;
}) {
  return (
    <article
      className={`ag-card ${phaseClass(a.phase)} ${a.enabled ? '' : 'off'} ${a.broken ? 'broken' : ''}`}
      onClick={onDetails}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          onDetails();
        }
      }}
      aria-label={`${a.name} details`}
    >
      <header>
        <span className="agent-icon" aria-hidden>
          {a.icon}
        </span>
        <div className="ag-title">
          <h4>{a.name}</h4>
          <span>
            {a.team || a.phase}
            {a.custom ? ' · Custom' : ''}
          </span>
        </div>
        <Toggle a={a} onChange={onToggle} busy={busy} />
      </header>
      <p className="ag-sum">{a.summary}</p>
      <div className="ag-meta">
        <span className="ag-chip">
          <Ico
            svg={
              a.runner === 'code' || a.runner === 'panel'
                ? I.pr
                : a.runner === 'document'
                  ? I.doc
                  : a.runner === 'testing'
                    ? I.test
                    : I.sparkle
            }
          />
          {a.workspaceLabel}
        </span>
        {modelOf(a) && <span className="ag-chip mono">{modelOf(a)}</span>}
        {a.runner === 'code' && <span className="ag-chip">{a.writes ? 'Edits code' : 'Read-only'}</span>}
        {a.broken && <span className="ag-chip bad">Rules need fixing</span>}
      </div>
      <footer onClick={(e) => e.stopPropagation()}>
        <button className="btn sm subtle" onClick={onDetails}>
          Details
        </button>
        {a.runner === 'testing' ? (
          <span className="muted small">{a.enabled ? 'Runs in test runs' : 'Off in test runs'}</span>
        ) : (
          onHire && (
            <button
              className="btn sm"
              disabled={!a.enabled}
              onClick={onHire}
              title={a.enabled ? `Put ${a.name} to work on an epic` : 'Turn it on first'}
            >
              <Ico svg={I.bot} />
              Hire
            </button>
          )
        )}
      </footer>
    </article>
  );
}

/** Remove (hide) or restore TicketForge's built-in agents. Removed ones stay restorable. */
function BuiltInsModal({ data: first, onData }: { data: Any; onData: (d: Any) => void }) {
  const [data, setData] = useState<Any>(first);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  const list: Any[] = data.builtIns || [];
  const act = async (action: 'remove' | 'restore', ids: string[]) => {
    if (!ids.length) return;
    setBusy(action);
    try {
      const d = await agentsAction({ action, ids });
      onData(d);
      setData(d);
      setSel(new Set());
      toast(`${ids.length} built-in agent${ids.length === 1 ? '' : 's'} ${action === 'remove' ? 'removed' : 'restored'}`);
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const toggle = (id: string) =>
    setSel((x) => {
      const n = new Set(x);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const active = list.filter((b) => !b.removed),
    removed = list.filter((b) => b.removed);
  const kind = (b: Any) =>
    b.runner === 'code'
      ? b.writes
        ? 'Edits code'
        : 'Reviews code'
      : b.runner === 'testing'
        ? 'Test runs'
        : b.runner === 'panel'
          ? 'Review panel'
          : 'Documents';
  return (
    <Modal title="Built-in agents" wide actions={[{ label: 'Close' }]}>
      <p className="muted small" style={{ marginTop: 0 }}>
        TicketForge comes with these agents. Remove the ones you don’t want; your custom agents take over their jobs (set which under{' '}
        <b>Default agents</b>). Removed agents can be restored at any time. Document features (test cases, agent documents…) keep working
        from the epic; they just leave this catalog.
      </p>
      <div className="bi-bar">
        <button
          className="btn danger-subtle"
          disabled={!!busy || !active.length}
          onClick={() =>
            act(
              'remove',
              active.map((b) => b.id),
            )
          }
        >
          {busy === 'remove' ? <Spinner /> : null}Remove all built-in agents ({active.length})
        </button>
        {removed.length > 0 && (
          <button
            className="btn"
            disabled={!!busy}
            onClick={() =>
              act(
                'restore',
                removed.map((b) => b.id),
              )
            }
          >
            Restore all ({removed.length})
          </button>
        )}
        <span className="spacer" />
        {sel.size > 0 && (
          <>
            <button
              className="btn sm danger-subtle"
              disabled={!!busy}
              onClick={() =>
                act(
                  'remove',
                  [...sel].filter((id) => active.some((b) => b.id === id)),
                )
              }
            >
              Remove selected
            </button>
            <button
              className="btn sm"
              disabled={!!busy}
              onClick={() =>
                act(
                  'restore',
                  [...sel].filter((id) => removed.some((b) => b.id === id)),
                )
              }
            >
              Restore selected
            </button>
          </>
        )}
      </div>
      <ul className="bi-list">
        {list.map((b) => (
          <li key={b.id} className={b.removed ? 'removed' : ''}>
            <label>
              <input type="checkbox" checked={sel.has(b.id)} onChange={() => toggle(b.id)} />
              <span className="agent-icon sm" aria-hidden>
                {b.icon}
              </span>
              <b>{b.name}</b>
              <span className="muted small">{kind(b)}</span>
            </label>
            <span className={`bi-state ${b.removed ? 'off' : 'on'}`}>{b.removed ? 'Removed' : 'In use'}</span>
            <button className="btn sm subtle" disabled={!!busy} onClick={() => act(b.removed ? 'restore' : 'remove', [b.id])}>
              {b.removed ? 'Restore' : 'Remove'}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** Which agent does each code job: Write code, Frontend, Backend, Review. */
function DefaultAgents({ data, onData }: { data: Any; onData: (d: Any) => void }) {
  const [busy, setBusy] = useState(false);
  const roles = data.roles || {};
  const options = (writes: boolean) =>
    data.agents.filter((a: Any) => a.runner === 'code' && !a.broken && a.enabled && Boolean(a.writes) === writes);
  const set = async (key: string, id: string) => {
    setBusy(true);
    const next: Any = Object.fromEntries(Object.entries(roles).map(([k, r]: Any) => [k, r.chosen || '']));
    next[key] = id;
    try {
      onData(await agentsAction({ action: 'roles', roles: Object.fromEntries(Object.entries(next).filter(([, v]) => v)) }));
      toast('Default agents saved');
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };
  const nameOf = (id: string) => data.agents.find((a: Any) => a.id === id)?.name || id;
  return (
    <section className="ag-roles">
      <div className="ag-roles-h">
        <b>Default agents</b>
        <span className="muted small">
          Who does each job when nobody picks an agent: Write code with AI, bulk coding, and the reviews of a code job.
        </span>
      </div>
      <div className="ag-roles-grid">
        {Object.entries(roles).map(([k, r]: Any) => (
          <label key={k} className="field" style={{ margin: 0 }}>
            <span>{r.label}</span>
            <SF value={r.chosen || ''} disabled={busy} onChange={(e) => set(k, e.target.value)}>
              <MenuItem value="">Automatic{r.agent ? ` (${nameOf(r.agent)})` : ''}</MenuItem>
              {options(r.writes).map((a: Any) => (
                <MenuItem key={a.id} value={a.id}>
                  {a.icon} {a.name}
                  {a.custom ? ' · custom' : ''}
                </MenuItem>
              ))}
            </SF>
            {!r.agent && (
              <small className="bad-text">
                No {r.writes ? 'code' : 'review'} agent: create one{r.writes ? ' (kind: Code)' : ' (kind: Review)'}.
              </small>
            )}
          </label>
        ))}
      </div>
    </section>
  );
}

export function AgentsTab() {
  const [data, setData] = useState<Any>(null);
  const [err, setErr] = useState<Any>(null);
  const [phase, setPhase] = useState('All');
  const [team, setTeam] = useState('');
  const [state, setState] = useState('');
  const [q, setQ] = useState('');
  const [view, setView] = useState<string>(() => {
    try {
      return localStorage.getItem('tf.agents.view') || 'cards';
    } catch {
      return 'cards';
    }
  });
  const [busy, setBusy] = useState('');
  const load = async () => {
    setErr(null);
    try {
      const d = await getAgents();
      setData(d);
      setAgentsCache(d);
    } catch (e: Any) {
      setErr(e);
    }
  };
  useEffect(() => {
    load();
  }, []);
  if (err)
    return (
      <div className="card">
        <ErrorState compact title="Couldn’t load the agents" error={err} onRetry={load} />
      </div>
    );
  if (!data)
    return (
      <Loading>
        <div className="agent-grid">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="agent-card">
              <div className="agent-head">
                <Sk w={44} h={44} r={12} />
                <div>
                  <Sk w={140} h={14} />
                  <Sk w={60} h={10} style={{ marginTop: 6 }} />
                </div>
              </div>
              <Sk w="90%" h={10} />
              <Sk w="60%" h={10} />
            </div>
          ))}
        </div>
      </Loading>
    );

  const save = async (id: string, v: Any, quiet = false) => {
    const agents: Any = {};
    for (const a of data.agents) agents[a.id] = { enabled: a.enabled, model: a.model, effort: a.effort, instructions: a.instructions };
    agents[id] = v;
    try {
      const d = await saveAgents(agents);
      setData(d);
      setAgentsCache(d);
      if (!quiet) toast('Agent saved');
    } catch (e: Any) {
      toast(e.message, 'err');
    }
  };
  const toggle = async (a: Any, on: boolean) => {
    setBusy(a.id);
    await save(a.id, { enabled: on, model: a.model, effort: a.effort, instructions: a.instructions }, true);
    setBusy('');
    toast(`${a.name} turned ${on ? 'on' : 'off'}`);
  };
  const hire = (a: Any) => openModal(<HireModal a={a} />);
  const onData = (d: Any) => {
    setData(d);
    setAgentsCache(d);
  };
  const details = (a: Any) => openModal(<AgentDetails a={a} data={data} onSave={save} onHire={() => hire(a)} onData={onData} />);
  const create = () => openModal(<CustomAgentModal onSaved={onData} builtIns={data.builtIns} />);
  const setV = (v: string) => {
    setView(v);
    try {
      localStorage.setItem('tf.agents.view', v);
    } catch {
      /* storage off */
    }
  };
  const qq = q.trim().toLowerCase();
  const all: Any[] = data.agents;
  const list = all.filter(
    (a: Any) =>
      (phase === 'All' || a.phase === phase) &&
      (!team || a.team === team) &&
      (!state || (state === 'on' ? a.enabled : state === 'off' ? !a.enabled : state === 'custom' ? a.custom : a.runner === state)) &&
      (!qq || `${a.name} ${a.summary} ${a.step || ''} ${a.team || ''} ${a.workspaceLabel || ''}`.toLowerCase().includes(qq)),
  );
  const teams = (data.teams || []).filter((tm: string) => all.some((a: Any) => a.team === tm));
  const groups: [string, Any[]][] =
    phase === 'All'
      ? data.phases.map((p: string) => [p, list.filter((a: Any) => a.phase === p)]).filter(([, l]: Any) => l.length)
      : [[phase, list]];
  const stats: [string, number, string][] = [
    ['Agents', all.length, ''],
    ['On', all.filter((a: Any) => a.enabled).length, 'ok'],
    ['Off', all.filter((a: Any) => !a.enabled).length, ''],
    ['Code agents', all.filter((a: Any) => a.runner === 'code' || a.runner === 'panel').length, ''],
    ['Custom', all.filter((a: Any) => a.custom).length, ''],
  ];
  const filtering = Boolean(phase !== 'All' || team || state || qq);
  const hireFor = (a: Any) => (a.runner === 'testing' || a.broken ? undefined : () => hire(a));

  return (
    <div className="ag-page">
      <div className="ag-head">
        <div>
          <h2>Agents</h2>
          <p className="muted small">
            AI teammates for each step of a feature: plan, build, review, test and release. Turn them on or off, tune their model and
            instructions, or create your own.
            {data.updatedAt && (
              <>
                {' '}
                Last changed by {data.updatedBy || 'an administrator'} {ago(data.updatedAt)}.
              </>
            )}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => openModal(<BuiltInsModal data={data} onData={onData} />)}>
            Built-in agents{data.removed?.length ? ` (${data.removed.length} removed)` : ''}
          </button>
          {can('ai.use') && (
            <button className="btn primary" onClick={create}>
              <Ico svg={I.plus} />
              Create agent
            </button>
          )}
        </div>
      </div>
      <div className="ag-stats">
        {stats.map(([l, n, tone]) => (
          <div key={l} className={`ag-stat ${tone}`}>
            <b>{n}</b>
            <span>{l}</span>
          </div>
        ))}
      </div>
      <DefaultAgents data={data} onData={onData} />
      {!all.length && (
        <EmptyState
          icon={I.bot}
          tone="neutral"
          title="No agents yet"
          actions={
            can('ai.use') ? (
              <>
                <button
                  className="btn primary"
                  onClick={() => openModal(<CustomAgentModal onSaved={onData} builtIns={data.builtIns} start="__repo" />)}
                >
                  🧬 Start with the Repo-native Builder
                </button>
                <button className="btn" onClick={create}>
                  <Ico svg={I.plus} />
                  Create your own
                </button>
              </>
            ) : null
          }
        >
          <p>
            All built-in agents are removed. Create your own: describe what it should do and the AI writes its rules, or start from a
            template. Restore built-in agents any time from <b>Built-in agents</b>.
          </p>
        </EmptyState>
      )}

      {all.length > 0 && (
        <div className="ag-toolbar">
          <div className="ag-phases" role="tablist" aria-label="Phase">
            {['All', ...data.phases].map((p: string) => {
              const n = p === 'All' ? all.length : all.filter((a: Any) => a.phase === p).length;
              return (
                <button
                  key={p}
                  role="tab"
                  aria-selected={phase === p}
                  className={`${phase === p ? 'on' : ''} ${p === 'All' ? 'ph-all' : phaseClass(p)}`}
                  onClick={() => setPhase(p)}
                >
                  {p !== 'All' && <i className="ph-dot" />}
                  {p}
                  <span>{n}</span>
                </button>
              );
            })}
          </div>
          <div className="ag-tools">
            <TF
              search
              sx={{ width: 220 }}
              value={q}
              placeholder="Search agents"
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search agents"
            />
            {teams.length > 1 && (
              <SF filter value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team">
                <MenuItem value="">All teams</MenuItem>
                {teams.map((tm: string) => (
                  <MenuItem key={tm} value={tm}>
                    {tm}
                  </MenuItem>
                ))}
              </SF>
            )}
            <SF filter value={state} onChange={(e) => setState(e.target.value)} aria-label="Show">
              <MenuItem value="">Any status</MenuItem>
              <MenuItem value="on">Turned on</MenuItem>
              <MenuItem value="off">Turned off</MenuItem>
              <MenuItem value="custom">Custom agents</MenuItem>
              <MenuItem value="code">Code agents</MenuItem>
              <MenuItem value="document">Document agents</MenuItem>
              <MenuItem value="testing">Testing agents</MenuItem>
            </SF>
            {filtering && (
              <button
                className="btn subtle sm"
                onClick={() => {
                  setPhase('All');
                  setTeam('');
                  setState('');
                  setQ('');
                }}
              >
                Clear
              </button>
            )}
            <div className="seg ag-view" role="tablist" aria-label="View">
              <button
                role="tab"
                aria-selected={view === 'cards'}
                className={view === 'cards' ? 'on' : ''}
                onClick={() => setV('cards')}
                title="Cards"
              >
                <Ico svg={I.grid} />
              </button>
              <button
                role="tab"
                aria-selected={view === 'list'}
                className={view === 'list' ? 'on' : ''}
                onClick={() => setV('list')}
                title="List"
              >
                <Ico svg={I.backlog} />
              </button>
            </div>
          </div>
        </div>
      )}

      {!all.length ? null : !list.length ? (
        <EmptyState
          compact
          icon={I.bot}
          tone="neutral"
          title="No agents match"
          actions={
            <button
              className="btn"
              onClick={() => {
                setPhase('All');
                setTeam('');
                setState('');
                setQ('');
              }}
            >
              Show all
            </button>
          }
        />
      ) : view === 'list' ? (
        <div className="table-wrap">
          <table className="tbl ag-tbl">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Phase</th>
                <th>Runs</th>
                <th>Model</th>
                <th>On</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((a: Any) => (
                <tr key={a.id} className={`click ${a.enabled ? '' : 'off'} ${phaseClass(a.phase)}`} onClick={() => details(a)}>
                  <td data-label="Agent">
                    <div className="ag-row">
                      <span className="agent-icon sm" aria-hidden>
                        {a.icon}
                      </span>
                      <div>
                        <b>{a.name}</b>
                        {a.custom && <span className="ag-chip tiny">Custom</span>}
                        <div className="muted small ag-row-sum">{a.summary}</div>
                      </div>
                    </div>
                  </td>
                  <td data-label="Phase">
                    <span className="ag-phase">
                      <i className="ph-dot" />
                      {a.phase}
                    </span>
                  </td>
                  <td data-label="Runs" className="muted small">
                    {a.workspaceLabel}
                  </td>
                  <td data-label="Model">{modelOf(a) ? <code>{modelOf(a)}</code> : <span className="muted">—</span>}</td>
                  <td data-label="On" onClick={(e) => e.stopPropagation()}>
                    <Toggle a={a} busy={busy === a.id} onChange={(on) => toggle(a, on)} />
                  </td>
                  <td className="ag-acts" onClick={(e) => e.stopPropagation()}>
                    {hireFor(a) && (
                      <button className="btn sm" disabled={!a.enabled} onClick={hireFor(a)}>
                        Hire
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        groups.map(([p, l]) => (
          <section key={p} className={`ag-group ${phaseClass(p)}`}>
            {phase === 'All' && (
              <h3 className="ag-group-h">
                <i className="ph-dot" />
                {p}
                <span className="count">{l.length}</span>
              </h3>
            )}
            <div className="ag-grid">
              {l.map((a: Any) => (
                <Card
                  key={a.id}
                  a={a}
                  busy={busy === a.id}
                  onDetails={() => details(a)}
                  onHire={hireFor(a)}
                  onToggle={(on) => toggle(a, on)}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
