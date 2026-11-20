'use client';
import { useState, useEffect } from 'react';
import { type Any, toast, aiBody, closeModal } from '../core';
import { agentsAction } from '../api/agents';
import { Modal, Ico, I } from '../ui';
import { SF, MenuItem, TA } from '../fields';

export const RUNNER: Record<string, string> = {
  code: 'Runs as a Claude Code agent in a git worktree',
  panel: 'Runs three Claude Code Review agents in parallel',
  generator: 'Runs TicketForge’s own writer with this agent’s instructions',
  document: 'Writes a Markdown document for the epic with Claude',
  testing: 'Runs inside Test automation: no hiring needed, turn it on or off here',
};
const KINDS: [string, string, string][] = [
  [
    'review',
    'Review (read-only)',
    'Reads the code and reports findings: reviews, audits, checks. Never edits.',
  ],
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
  {
    id: '__repo',
    label: '🧬 Repo-native Builder (builds from the repository and project)',
    md: REPO_BUILDER,
  },
];
/**
 * Create or edit a custom agent: describe it and the AI writes its rules, or paste / import a .md
 * file.
 */
export function CustomAgentModal({
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
              {
                label: busy === 'check' ? 'Checking…' : 'Check',
                disabled: !!busy || !md.trim(),
                onClick: verify,
              },
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
        <div
          className="row"
          style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}
        >
          <div className="seg" role="tablist" aria-label="How">
            <button
              role="tab"
              aria-selected={mode === 'describe'}
              className={mode === 'describe' ? 'on' : ''}
              onClick={() => setMode('describe')}
            >
              Describe it
            </button>
            <button
              role="tab"
              aria-selected={mode === 'md'}
              className={mode === 'md' ? 'on' : ''}
              onClick={() => setMode('md')}
            >
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
              <button
                key={k}
                role="radio"
                aria-checked={kind === k}
                className={kind === k ? 'on' : ''}
                onClick={() => setKind(k)}
              >
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
            The AI writes the agent’s Markdown rules (name, runner, model, Do / Don’t / Output). You
            review and edit them before saving.
          </p>
        </>
      ) : (
        <>
          <p className="muted small" style={{ marginTop: 0 }}>
            Same format as Claude Code agent files: a frontmatter block (<code>name</code>,{' '}
            <code>description</code>, <code>runner</code>: code · review · document, optional{' '}
            <code>model</code> and <code>icon</code>), then the instructions.
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
              <input
                type="file"
                accept=".md,text/markdown,text/plain"
                hidden
                onChange={(e) => file(e.target.files?.[0])}
              />
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
                <b>{check.name}</b> · {KINDS.find(([k]) => k === check.kind)?.[1]} ·{' '}
                {check.model || 'sonnet'} — ready to save.
              </span>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
