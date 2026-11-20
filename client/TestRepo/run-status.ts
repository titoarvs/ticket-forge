'use client';
import { type Any, P, mutate } from '../core';

// ---------------------------------------------------------------- model
export const RUN_STATUS = ['TODO', 'EXECUTING', 'PASSED', 'FAILED', 'BLOCKED'] as const;
export const STATUS_LABEL: Record<string, string> = {
  TODO: 'To do',
  EXECUTING: 'Executing',
  PASSED: 'Passed',
  FAILED: 'Failed',
  BLOCKED: 'Blocked',
};
export const TEST_TYPES = ['Manual', 'Automated', 'Cucumber', 'Exploratory'];
export const repo = (p: Any = P()) =>
  p.testRepo || { seq: { t: 0, tp: 0, te: 0 }, folders: [], tests: [], plans: [], executions: [] };
/** Changes the repository inside one undo step and save. */
export const edit = (fn: (r: Any, p: Any) => void, tag?: string) =>
  mutate(
    (pp: Any) => {
      pp.testRepo = {
        seq: { t: 0, tp: 0, te: 0 },
        folders: [],
        tests: [],
        plans: [],
        executions: [],
        ...(pp.testRepo || {}),
      };
      pp.testRepo.seq = { t: 0, tp: 0, te: 0, ...(pp.testRepo.seq || {}) };
      fn(pp.testRepo, pp);
    },
    tag ? { tag } : undefined,
  );
