'use client';
// Bringing pull requests up to date from GitHub / GitLab, one at a time, with progress. Opening the
// page quietly refreshes up to 12 open requests last read 10+ minutes ago.
import { useState, useRef, useEffect } from 'react';
import { type Any, toast } from '../../core';
import { refreshPr } from '../../actions';
import { ACTIVE, STALE_MS } from '../PrDetails';
import type { PrRow } from './filters';

const hosted = (r: Any) => ['GitHub', 'GitLab'].includes(r.provider);
const isStale = (r: Any) =>
  ACTIVE.includes(r.status) && hosted(r) && Date.now() - Date.parse(r.checkedAt || 0) > STALE_MS;

function reportRefresh(total: number, failed: number) {
  if (failed) toast(`${total - failed} of ${total} updated; ${failed} couldn’t be read.`, 'warn');
  else toast(`${total} request${total === 1 ? '' : 's'} updated`, 'ok');
}

export function usePrRefresh(rows: PrRow[], projectId: string, canEdit: boolean) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const stopRef = useRef(false);
  /** Refreshes the rows in turn (stops when the page closes); quiet: no message at the end. */
  const refreshList = async (list: PrRow[], quiet: boolean) => {
    if (!list.length) return;
    setProgress({ done: 0, total: list.length });
    let failed = 0;
    for (let i = 0; i < list.length && !stopRef.current; i++) {
      if (!(await refreshPr(list[i].t, list[i].r.id, { quiet: true }))) failed += 1;
      setProgress({ done: i + 1, total: list.length });
    }
    setProgress(null);
    if (!quiet) reportRefresh(list.length, failed);
  };
  useEffect(() => {
    stopRef.current = false;
    if (canEdit) refreshList(rows.filter((x) => isStale(x.r)).slice(0, 12), true);
    return () => {
      stopRef.current = true;
    };
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  return { progress, refreshList };
}
