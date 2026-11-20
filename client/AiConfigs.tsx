'use client';
// Administration → AI → Configurations: named AI setups (engine + model + reasoning + standing
// instructions), e.g. "Deep review: Claude Opus, thorough" or "Cheap drafts: OpenAI gpt-4.1-mini,
// fast". People pick one on any AI button ("Runs on"), and Model routing can send a whole task to
// one.
import { useState } from 'react';
import { api, toast, openModal, closeModal, uid, type Any } from './core';
import { Ico, I, Modal, Confirm, EmptyState } from './ui';
import { TF, TA, SF, CB, MenuItem, PeopleF } from './fields';

const ENGINE: Record<string, string> = {
  claude: 'Claude account (Claude Code)',
  copilot: 'GitHub Copilot',
  api: 'An AI API provider',
};
const REASONING: [string, string][] = [
  ['', 'Default (Generation settings)'],
  ['fast', 'Fast: no extended thinking'],
  ['balanced', 'Balanced'],
  ['thorough', 'Thorough: thinks deeply'],
];
const CLAUDE_MODELS = [
  'opus',
  'sonnet',
  'haiku',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
  'claude-fable-5-2',
];

function ConfigModal({ c, cfg, onSave }: { c: Any; cfg?: Any; onSave: (x: Any) => Promise<void> }) {
  const apis: Any[] = (c.apis || []).filter((x: Any) => x.entryId && x.configured);
  const [f, setF] = useState<Any>(() =>
    cfg
      ? { ...cfg }
      : {
          id: `c${uid().slice(0, 6)}`,
          name: '',
          engine: c.mode === 'account' ? 'claude' : 'api',
          providerId: apis[0]?.entryId || '',
          model: '',
          reasoning: '',
          instructions: '',
          enabled: true,
        },
  );
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: Any) => setF((x: Any) => ({ ...x, [k]: v }));
  const prov = apis.find((x) => x.entryId === f.providerId);
  const models =
    f.engine === 'claude'
      ? CLAUDE_MODELS
      : f.engine === 'copilot'
        ? (c.copilot?.models || []).filter(Boolean)
        : ([
            ...new Set(
              [...(prov ? Object.values(c.tierHints?.[prov.id] || {}) : []), prov?.model].filter(
                Boolean,
              ),
            ),
          ] as string[]);
  const ok = f.name.trim() && (f.engine !== 'api' || f.providerId);
  return (
    <Modal
      title={cfg ? `Edit ${cfg.name}` : 'New AI configuration'}
      wide
      actions={[
        { label: 'Cancel' },
        {
          label: busy ? 'Saving…' : 'Save',
          kind: 'primary',
          disabled: busy || !ok,
          onClick: async () => {
            setBusy(true);
            try {
              await onSave({ ...f, name: f.name.trim() });
              closeModal();
            } finally {
              setBusy(false);
            }
          },
        },
      ]}
    >
      <div className="grid2">
        <label className="field">
          <span>Name</span>
          <TF
            autoFocus
            value={f.name}
            placeholder="e.g. Deep review"
            onChange={(e) => set('name', e.target.value)}
          />
        </label>
        <label className="field">
          <span>Runs on</span>
          <SF value={f.engine} onChange={(e) => set('engine', e.target.value)}>
            {Object.entries(ENGINE).map(([k, l]) => (
              <MenuItem key={k} value={k}>
                {l}
              </MenuItem>
            ))}
          </SF>
        </label>
        {f.engine === 'api' && (
          <label className="field">
            <span>Provider</span>
            {apis.length ? (
              <SF value={f.providerId} onChange={(e) => set('providerId', e.target.value)}>
                {apis.map((x) => (
                  <MenuItem key={x.entryId} value={x.entryId}>
                    {x.label}
                    {x.model ? ` (${x.model})` : ''}
                  </MenuItem>
                ))}
              </SF>
            ) : (
              <span className="muted small">Add an AI API under Providers first.</span>
            )}
          </label>
        )}
        <label className="field">
          <span>Model</span>
          <PeopleF
            avatars={false}
            value={f.model}
            onChange={(v) => set('model', v.trim())}
            options={models}
            placeholder={
              f.engine === 'api'
                ? prov?.model || 'The provider’s model'
                : f.engine === 'copilot'
                  ? 'Copilot’s default'
                  : 'sonnet'
            }
          />
        </label>
        <label className="field">
          <span>Reasoning</span>
          <SF value={f.reasoning} onChange={(e) => set('reasoning', e.target.value)}>
            {REASONING.map(([k, l]) => (
              <MenuItem key={k || 'd'} value={k}>
                {l}
              </MenuItem>
            ))}
          </SF>
        </label>
      </div>
      <label className="field">
        <span>Standing instructions (optional)</span>
        <TA
          rows={3}
          value={f.instructions}
          placeholder="e.g. Answer in British English. Prefer short sentences. Never invent API names."
          onChange={(e) => set('instructions', e.target.value)}
        />
      </label>
      <CB
        label="Available on AI buttons"
        checked={f.enabled}
        onChange={(e: Any) => set('enabled', e.target.checked)}
      />
      {f.engine !== 'api' && c.mode !== 'account' && (
        <p className="warn-text small">
          Claude account and GitHub Copilot run only when TicketForge is opened on your own
          computer. On a web address this configuration falls back to the usual AI.
        </p>
      )}
    </Modal>
  );
}

export function ConfigsSection({ c, onSaved }: { c: Any; onSaved: (st: Any) => void }) {
  const list: Any[] = c.settings?.configs || [];
  const save = async (next: Any[]) => {
    try {
      onSaved(await api('/api/admin/ai', { method: 'PATCH', body: { configs: next } }));
      toast('Configurations saved');
    } catch (e: Any) {
      toast(e.message, 'err');
      throw e;
    }
  };
  const upsert = (x: Any) =>
    save(list.some((y) => y.id === x.id) ? list.map((y) => (y.id === x.id ? x : y)) : [...list, x]);
  const edit = (cfg?: Any) => openModal(<ConfigModal c={c} cfg={cfg} onSave={upsert} />);
  const apiName = (id: string) =>
    (c.apis || []).find((x: Any) => x.entryId === id)?.label || 'a removed provider';
  return (
    <div className="cards">
      <div className="card wide">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3>Custom AI configurations</h3>
            <p className="sub">
              Named setups people can choose on any AI button (<b>Runs on</b>), and that Model
              routing can assign to a task. Each one names the AI, the model, how hard it thinks and
              standing instructions.
            </p>
          </div>
          <button className="btn primary" onClick={() => edit()}>
            <Ico svg={I.plus} />
            New configuration
          </button>
        </div>
        {list.length ? (
          <div className="prov-list">
            {list.map((x) => (
              <div key={x.id} className={`prov ${x.enabled ? '' : 'off'}`}>
                <div className="prov-main">
                  <div className="prov-info">
                    <div className="row" style={{ gap: 8 }}>
                      <b>{x.name}</b>
                      {x.model && <code>{x.model}</code>}
                      {!x.enabled && <span className="loz">Off</span>}
                    </div>
                    <div className="muted small">
                      {x.engine === 'api' ? apiName(x.providerId) : ENGINE[x.engine]}
                      {x.reasoning ? ` · ${x.reasoning}` : ''}
                      {x.instructions
                        ? ` · “${x.instructions.slice(0, 80)}${x.instructions.length > 80 ? '…' : ''}”`
                        : ''}
                    </div>
                  </div>
                  <div className="prov-actions">
                    <button className="btn sm subtle" onClick={() => edit(x)}>
                      Edit
                    </button>
                    <button
                      className="icon-btn"
                      aria-label={`Remove ${x.name}`}
                      title="Remove"
                      onClick={() =>
                        openModal(
                          <Confirm
                            title={`Remove ${x.name}?`}
                            label="Remove"
                            text="Tasks routed to it go back to their tier, and people who picked it go back to Auto."
                            onYes={() => save(list.filter((y) => y.id !== x.id))}
                          />,
                        )
                      }
                    >
                      <Ico svg={I.trash} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            compact
            icon={I.sparkle}
            title="No configurations yet"
            actions={
              <button className="btn primary" onClick={() => edit()}>
                <Ico svg={I.plus} />
                New configuration
              </button>
            }
          >
            <p>
              For example “Deep review” on Claude Opus with thorough reasoning, or “Cheap drafts” on
              a mini model.
            </p>
          </EmptyState>
        )}
      </div>
    </div>
  );
}
