'use client';
// Fields for one rule: a number, a check box, and the "· default …" note shown when a rule differs
// from its default.
import type { Any } from '../../core';
import { TF, CB } from '../../fields';
import { type Rules, getPath } from './use-rules';

const shown = (dv: Any) => {
  if (Array.isArray(dv)) return dv.join(', ');
  if (typeof dv === 'boolean') return dv ? 'on' : 'off';
  return String(dv || 'none');
};

/** "· default 5", only when the rule at `path` isn't the default. */
export function DefaultNote({ g, path }: { g: Rules; path: string }) {
  const dv = getPath(g.data.defaults, path);
  if (JSON.stringify(dv) === JSON.stringify(g.get(path))) return null;
  return <span className="muted small gen-def"> · default {shown(dv)}</span>;
}

type NumProps = { g: Rules; path: string; label: string; min: number; max: number };

/** A number rule. Paths under "testmgmt." go through setTm (it may switch the standard to custom). */
export function NumField({ g, path, label, min, max }: NumProps) {
  const tm = path.startsWith('testmgmt.');
  const change = (v: number) => (tm ? g.setTm(path.slice('testmgmt.'.length), v) : g.set(path, v));
  return (
    <label className="field">
      <span>
        {label}
        <DefaultNote g={g} path={path} />
      </span>
      <TF
        type="number"
        value={g.get(path)}
        slotProps={{ htmlInput: { min, max } }}
        onChange={(e) => change(Number(e.target.value))}
      />
    </label>
  );
}

export function CheckField({ g, path, label }: { g: Rules; path: string; label: string }) {
  return (
    <CB
      label={
        <>
          {label}
          <DefaultNote g={g} path={path} />
        </>
      }
      checked={Boolean(g.get(path))}
      onChange={(e: Any) => g.set(path, e.target.checked)}
    />
  );
}

/** A label with its default note, for fields built by hand. */
export function RuleLabel({
  g,
  path,
  children,
}: {
  g: Rules;
  path: string;
  children: React.ReactNode;
}) {
  return (
    <span>
      {children}
      <DefaultNote g={g} path={path} />
    </span>
  );
}
