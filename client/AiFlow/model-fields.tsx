'use client';
// The model each AI uses for a tier, and the bar that saves those choices.
import type { Any } from '../core';
import { Spinner } from '../ui';
import { SF, MenuItem, PeopleF } from '../fields';
import type { FNode } from './model';
import { CLAUDE_OPTIONS } from './model';
import type { Flow } from './flow';

function placeholderOf(f: Flow, tier: string, node: FNode) {
  if (node.kind === 'local')
    return node.data.which === 'claude' ? f.c.claudeTiers?.[tier] : 'Same as Local AI';
  return node.data.model || f.c.tierHints?.[node.data.id]?.[tier] || 'Provider’s model';
}

/** The model `node` uses for `tier`. Changes wait for the Save bar. */
export function TierModelField({ f, tier, node }: { f: Flow; tier: string; node: FNode }) {
  const { r, setR } = f.routing;
  const placeholder = placeholderOf(f, tier, node);
  if (node.kind === 'local' && node.data.which === 'copilot')
    return (
      <SF
        value={r.copilot?.[tier] || ''}
        onChange={(e) =>
          setR((x: Any) => ({ ...x, copilot: { ...x.copilot, [tier]: e.target.value } }))
        }
      >
        {(f.c.copilot?.models || ['']).map((m: string) => (
          <MenuItem key={m || 'd'} value={m}>
            {m || 'Same as Local AI'}
          </MenuItem>
        ))}
      </SF>
    );
  if (node.kind === 'local')
    return (
      <PeopleF
        avatars={false}
        value={r.claude?.[tier] || ''}
        onChange={(v) => setR((x: Any) => ({ ...x, claude: { ...x.claude, [tier]: v.trim() } }))}
        options={CLAUDE_OPTIONS}
        placeholder={placeholder}
      />
    );
  const id = node.data.entryId;
  const opts = [
    ...new Set([f.c.tierHints?.[node.data.id]?.[tier], node.data.model].filter(Boolean)),
  ];
  const setModel = (v: string) =>
    setR((x: Any) => ({
      ...x,
      api: {
        ...x.api,
        [id]: { high: '', standard: '', light: '', ...(x.api?.[id] || {}), [tier]: v.trim() },
      },
    }));
  return (
    <PeopleF
      avatars={false}
      value={r.api?.[id]?.[tier] || ''}
      onChange={setModel}
      options={opts as string[]}
      placeholder={placeholder}
    />
  );
}

/** Shown while model names have unsaved changes. */
export function ModelSaveBar({ f }: { f: Flow }) {
  const { r, setR, savedKey, saving, dirty, patchRouting } = f.routing;
  if (!dirty) return null;
  return (
    <div className="fi-save">
      <span>Unsaved model changes</span>
      <button type="button" className="btn sm" onClick={() => setR(JSON.parse(savedKey))}>
        Discard
      </button>
      <button
        type="button"
        className="btn sm primary"
        disabled={saving}
        onClick={() => patchRouting(r, 'Models saved. New AI work uses them right away.')}
      >
        {saving ? <Spinner /> : 'Save'}
      </button>
    </div>
  );
}
