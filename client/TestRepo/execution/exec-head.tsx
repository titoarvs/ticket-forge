'use client';
// The execution's progress (bar and counts), importing automated results, and changing several
// selected runs at once.
import { type Any, peopleNames } from '../../core';
import { Ico, I } from '../../ui';
import { SF, MenuItem } from '../../fields';
import { RUN_STATUS, STATUS_LABEL } from '../run-status';
import { StatusBar, counts } from '../TestManagement';
import { importJunit } from '../CsvImportModal';
import { updateSelected } from './run-ops';

function ImportJunit({ execId }: { execId: string }) {
  return (
    <label
      className="btn sm subtle xr-file"
      title="Import automated results from a JUnit XML report (Playwright, Jest, pytest, Cypress, JUnit…)"
    >
      <Ico svg={I.upload} />
      Import JUnit XML
      <input
        type="file"
        accept=".xml,text/xml"
        hidden
        onChange={async (ev) => {
          const f = ev.target.files?.[0];
          ev.target.value = '';
          if (f) importJunit(execId, await f.text(), f.name);
        }}
      />
    </label>
  );
}

export function ExecHead({ e, ed }: { e: Any; ed: boolean }) {
  const st = e.testIds.map((t: string) => e.runs?.[t]?.status || 'TODO');
  const n = counts(st);
  return (
    <div className="xr-exec-head">
      <StatusBar statuses={st} />
      <span className="small muted">
        {n.PASSED} passed · {n.FAILED} failed · {n.BLOCKED} blocked · {n.TODO + n.EXECUTING} to do
        {e.environment ? ` · ${e.environment}` : ''}
      </span>
      <span className="spacer" />
      {ed && <ImportJunit execId={e.id} />}
    </div>
  );
}

type BulkProps = { execId: string; picked: string[]; clear: () => void };

/** A result or an assignee for every selected run. */
export function BulkBar({ execId, picked, clear }: BulkProps) {
  const apply = (patch: Any) => updateSelected(execId, picked, patch);
  return (
    <div className="xr-bulk small">
      <b>{picked.length} selected</b>
      <SF
        filter
        value=""
        onChange={(ev) => {
          if (ev.target.value) apply({ status: ev.target.value });
        }}
        aria-label="Set result"
      >
        <MenuItem value="">Set result…</MenuItem>
        {RUN_STATUS.map((x) => (
          <MenuItem key={x} value={x}>
            {STATUS_LABEL[x]}
          </MenuItem>
        ))}
      </SF>
      <SF
        filter
        value=""
        onChange={(ev) => {
          if (ev.target.value) apply({ assignee: ev.target.value === '-' ? '' : ev.target.value });
        }}
        aria-label="Assign"
      >
        <MenuItem value="">Assign to…</MenuItem>
        <MenuItem value="-">Unassigned</MenuItem>
        {peopleNames().map((name: string) => (
          <MenuItem key={name} value={name}>
            {name}
          </MenuItem>
        ))}
      </SF>
      <button className="link-btn small" onClick={clear}>
        Clear
      </button>
    </div>
  );
}
