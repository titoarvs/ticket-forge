'use client';
import { useState, useEffect } from 'react';
import { type Any, openModal, closeModal, toast, S } from '../core';
import { agentsAction, deleteAgent } from '../api/agents';
import { listProjects, getProject } from '../api/projects';
import { Modal, Ico, I, Spinner } from '../ui';
import { CB, SF, MenuItem, TA } from '../fields';
import { Markdown } from '../GuideCard';
import { phaseClass } from '../Agents';
import { CustomAgentModal, RUNNER } from './CustomAgentModal';

export function AgentDetails({
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
  const [v, setV] = useState({
    enabled: a.enabled,
    model: a.model || '',
    effort: a.effort || '',
    instructions: a.instructions || '',
  });
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
                onClick={() =>
                  openModal(
                    <CustomAgentModal onSaved={onData} builtIns={data.builtIns} start={a.id} />,
                  )
                }
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
            <button
              className="btn"
              onClick={() => openModal(<CustomAgentModal a={a} onSaved={onData} />)}
            >
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
            {a.writes
              ? 'Edits files only in the issue’s worktree.'
              : 'Read-only: it never edits files.'}{' '}
            Plus the project’s check command, when one is set. It can never commit, push, switch
            branches or browse the web.
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
      <CB
        label="Turned on (people can hire it)"
        checked={v.enabled}
        onChange={(e: Any) => setV({ ...v, enabled: e.target.checked })}
      />
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
            <small className="muted">
              A project’s own model (Project settings → Code & GitHub) wins for jobs in that
              project.
            </small>
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
/**
 * Hire from Administration: choose the project and epic, then the epic opens with the agent at
 * work.
 */
export function HireModal({ a }: { a: Any }) {
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
      actions={[
        { label: 'Cancel' },
        { label: 'Hire', kind: 'primary', disabled: !pid || !eid, onClick: go },
      ]}
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
            {a.runner === 'code' || a.runner === 'panel'
              ? 'you pick the issue for the agent to work on.'
              : 'the agent starts there.'}
          </p>
        </>
      )}
    </Modal>
  );
}
