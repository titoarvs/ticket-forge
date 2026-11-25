'use client';
import { useState } from 'react';
import Popover from '@mui/material/Popover';
import { type Any, statusColor, mutate, wCls } from '../core';
import { TF } from '../fields';

export function CommitName({
  value,
  onCommit,
  disabled,
}: {
  value: string;
  onCommit: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <TF
      key={value}
      disabled={disabled}
      defaultValue={value}
      aria-label="Status name"
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v !== value) onCommit(v);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          (e.target as HTMLInputElement).value = value;
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
export const PRESETS = [
  '#626f86',
  '#0c66e4',
  '#1d7afc',
  '#206a83',
  '#1f845a',
  '#5b7f24',
  '#b38600',
  '#e06c00',
  '#c9372c',
  '#ae2e24',
  '#943d73',
  '#6e5dc6',
];
/** A status's colour: preset swatches, any custom colour, or back to its category's default. */
export function StatusColorPicker({ w, disabled }: { w: Any; disabled?: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const cur = statusColor(w);
  const set = (c: string) =>
    mutate(
      () => {
        if (c) w.color = c;
        else delete w.color;
      },
      { tag: `color${w.id}` },
    );
  return (
    <>
      <button
        type="button"
        className="color-btn"
        disabled={disabled}
        aria-label={`Color of ${w.name}: ${cur || 'default'}`}
        title={disabled ? undefined : 'Change color'}
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        <span className={`loz ${wCls(w)}`}>{w.name}</span>
      </button>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <div className="color-pop" role="dialog" aria-label={`Color of ${w.name}`}>
          <div className="color-grid">
            {PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                className={`color-sw ${cur.toLowerCase() === c ? 'on' : ''}`}
                style={{ background: c }}
                title={c}
                aria-label={c}
                aria-pressed={cur.toLowerCase() === c}
                onClick={() => set(c)}
              />
            ))}
          </div>
          <label className="color-custom small">
            <input type="color" value={cur || '#0c66e4'} onChange={(e) => set(e.target.value)} />
            Custom color{cur && <span className="muted"> · {cur}</span>}
          </label>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className={`loz ${wCls(w)}`}>{w.name}</span>
            <button type="button" className="btn sm subtle" disabled={!cur} onClick={() => set('')}>
              Use default
            </button>
          </div>
        </div>
      </Popover>
    </>
  );
}
