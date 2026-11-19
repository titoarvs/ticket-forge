'use client';
// Models per tier: which model each AI (Claude account, GitHub Copilot, each AI API) uses for High,
// Standard and Light.
import type { Any } from '../../core';
import { PeopleF, SF, MenuItem } from '../../fields';
import { TIER_LABEL, CLAUDE_OPTIONS } from '../presets';
import type { RoutingDraft } from './use-routing-draft';
import { PartLink } from './routing-card';

type RowProps = { c: Any; d: RoutingDraft; tiers: string[] };

function AiName({ name, note }: { name: string; note: string }) {
  return (
    <td className="rt-ai">
      <b>{name}</b>
      <span>{note}</span>
    </td>
  );
}

function ClaudeRow({ c, d, tiers }: RowProps) {
  return (
    <tr>
      <AiName name="Claude account" note="Claude Code on this computer" />
      {tiers.map((k) => (
        <td key={k}>
          <PeopleF
            avatars={false}
            disabled={d.off}
            value={d.r.claude[k]}
            onChange={(v) => d.setModel('claude', k, v.trim())}
            options={CLAUDE_OPTIONS}
            placeholder={c.claudeTiers?.[k]}
          />
        </td>
      ))}
    </tr>
  );
}

function CopilotRow({ c, d, tiers }: RowProps) {
  const note = c.localEngine === 'copilot' ? 'Your local AI' : 'Backup for your Claude account';
  return (
    <tr>
      <AiName name="GitHub Copilot" note={note} />
      {tiers.map((k) => (
        <td key={k}>
          <SF
            value={d.r.copilot[k]}
            disabled={d.off}
            onChange={(e) => d.setModel('copilot', k, e.target.value)}
          >
            {(c.copilot.models || ['']).map((m: string) => (
              <MenuItem key={m || 'd'} value={m}>
                {m || `Same as Local AI (${c.copilotModel || 'default'})`}
              </MenuItem>
            ))}
          </SF>
        </td>
      ))}
    </tr>
  );
}

/** An AI API; a blank field uses the provider's own model. */
function ApiRow({ c, d, tiers, x }: RowProps & { x: Any }) {
  const hint = c.tierHints?.[x.id] || {};
  const note = `${x.model ? `Own model: ${x.model}` : 'API'}${x.source === 'env' ? ' · environment' : ''}`;
  return (
    <tr>
      <AiName name={x.label} note={note} />
      {tiers.map((k) => (
        <td key={k}>
          <PeopleF
            avatars={false}
            disabled={d.off}
            value={d.r.api[x.entryId]?.[k] || ''}
            onChange={(v) => d.setModel('api', k, v.trim(), x.entryId)}
            options={[...new Set([hint[k], x.model].filter(Boolean))] as string[]}
            placeholder={x.model || hint[k] || 'Provider’s model'}
          />
        </td>
      ))}
    </tr>
  );
}

export function ModelsCard({ c, d, go }: { c: Any; d: RoutingDraft; go?: (k: string) => void }) {
  const tiers: string[] = c.tiers || ['high', 'standard', 'light'];
  const local = c.mode === 'account';
  return (
    <div className={`card wide ${d.off ? 'rt-off' : ''}`}>
      <h3>Models for each tier</h3>
      <p className="sub">
        Which model each AI uses for a tier. A blank API field uses that provider’s own model.
      </p>
      <div className="rt-scroll rt-models">
        <table className="rt-tbl">
          <thead>
            <tr>
              <th>AI</th>
              {tiers.map((k) => (
                <th key={k}>{TIER_LABEL[k]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {local && <ClaudeRow c={c} d={d} tiers={tiers} />}
            {c.copilot?.available && <CopilotRow c={c} d={d} tiers={tiers} />}
            {d.apis.map((x) => (
              <ApiRow key={x.entryId} c={c} d={d} tiers={tiers} x={x} />
            ))}
            {!local && !d.apis.length && (
              <tr>
                <td colSpan={4} className="muted small">
                  No AI APIs yet: add one under Providers.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!local && (
        <p className="muted small" style={{ marginBottom: 0 }}>
          Your Claude account and GitHub Copilot rows show when TicketForge is opened on your own
          computer (localhost).
        </p>
      )}
      {d.off && (
        <p className="warn-text small" style={{ marginBottom: 0 }}>
          Model routing is off, so these aren’t used. Turn it on in{' '}
          <PartLink go={go} to="routing">
            Model routing
          </PartLink>
          .
        </p>
      )}
    </div>
  );
}
