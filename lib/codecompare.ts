// Compare the output of an AI code job with another state of the code (TF-121): the previous job run for the same issue,
// the repository's default branch, or the last run made under the prior spec. Everything comes from data that already
// exists (code jobs, the repository, coding specs); nothing is stored. The result is a plain unified diff that the
// browser draws side by side (client/DiffReview.tsx).
import { gh as ghApi } from './gh-actions';

export const COMPARE_TARGETS = ['job', 'default', 'spec'] as const;
export type CompareTarget = (typeof COMPARE_TARGETS)[number];
export const COMPARE_LABEL: Record<CompareTarget, string> = {
  job: 'Previous job run',
  default: 'Repository default branch',
  spec: 'Prior spec version',
};
const MAX_DIFF = 400_000;

export function compareTarget(v: unknown): CompareTarget {
  const t = String(v || '') as CompareTarget;
  if (!COMPARE_TARGETS.includes(t))
    throw Object.assign(
      new Error('Choose what to compare with: the previous job run, the repository default branch or the prior spec version.'),
      { status: 400 },
    );
  return t;
}

/** What the API returns: `diff` is a unified diff ('' = no changes); `available` is false when there is nothing to compare with. */
export function compareResult(
  target: CompareTarget,
  { against = '', diff = '', reason = '' }: { against?: string; diff?: string; reason?: string },
) {
  const cut = diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n… (diff cut at ${MAX_DIFF.toLocaleString()} characters)` : diff;
  return { target, label: COMPARE_LABEL[target], available: !reason, reason, against, diff: reason ? '' : cut };
}

/**
 * The earlier job to compare with. "Previous job run": the newest earlier job for the same issue and repository side that
 * changed files. "Prior spec version": the newest of those that started before the issue's current spec was generated,
 * as specs keep no history of their own (`specAt` is when the current spec was generated).
 */
export function baseJobFor(j: any, jobs: any[], target: CompareTarget, specAt = '') {
  const side = (x: any) => x.side || 'frontend';
  return (
    jobs
      .filter(
        (x) =>
          x.id !== j.id &&
          x.ticketId === j.ticketId &&
          side(x) === side(j) &&
          x.status !== 'discarded' &&
          x.files?.length &&
          String(x.startedAt) < String(j.startedAt),
      )
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
      .find((x) => target !== 'spec' || (specAt && String(x.startedAt) < specAt)) || null
  );
}
export const noBaseReason = (target: CompareTarget, specAt = '') =>
  target === 'spec'
    ? specAt
      ? 'No code run was made before the current spec was generated, so there is no earlier spec version to compare with.'
      : 'This issue has no coding spec, so there is no spec version to compare with.'
    : 'This is the first code run for this issue, so there is no previous job run to compare with.';

// ---------------------------------------------------------------- unified diff of two texts
const lines = (t: string) => {
  const x = String(t).split('\n');
  if (x[x.length - 1] === '') x.pop();
  return x;
};

/** A unified diff (3 lines of context) for one file; `null` stands for a file that doesn't exist on that side. Empty when equal. */
export function unifiedDiff(file: string, from: string | null, to: string | null, ctx = 3) {
  const a = from === null ? [] : lines(from),
    b = to === null ? [] : lines(to);
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length,
    eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) {
    ea--;
    eb--;
  }
  const A = a.slice(s, ea),
    B = b.slice(s, eb);
  const ops: [string, string][] = a.slice(0, s).map((l): [string, string] => [' ', l]);
  if (A.length * B.length > 4_000_000) {
    // too big for a line-by-line match: show the middle as replaced
    ops.push(...A.map((l): [string, string] => ['-', l]), ...B.map((l): [string, string] => ['+', l]));
  } else {
    const w = B.length + 1,
      t = new Uint32Array((A.length + 1) * w);
    for (let i = A.length - 1; i >= 0; i--)
      for (let k = B.length - 1; k >= 0; k--)
        t[i * w + k] = A[i] === B[k] ? t[(i + 1) * w + k + 1] + 1 : Math.max(t[(i + 1) * w + k], t[i * w + k + 1]);
    let i = 0,
      k = 0;
    while (i < A.length || k < B.length) {
      if (i < A.length && k < B.length && A[i] === B[k]) {
        ops.push([' ', A[i]]);
        i++;
        k++;
      } else if (i < A.length && (k === B.length || t[(i + 1) * w + k] >= t[i * w + k + 1])) ops.push(['-', A[i++]]);
      else ops.push(['+', B[k++]]);
    }
  }
  ops.push(...a.slice(ea).map((l): [string, string] => [' ', l]));
  const changed = ops.map((o, i) => (o[0] === ' ' ? -1 : i)).filter((i) => i >= 0);
  if (!changed.length) return '';
  const hunks: [number, number][] = [];
  for (const i of changed) {
    const lo = Math.max(0, i - ctx),
      hi = Math.min(ops.length - 1, i + ctx),
      last = hunks[hunks.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else hunks.push([lo, hi]);
  }
  const at: { a: number; b: number }[] = []; // line numbers (1-based) of each op on both sides
  let na = 1,
    nb = 1;
  for (const [t] of ops) {
    at.push({ a: na, b: nb });
    if (t !== '+') na++;
    if (t !== '-') nb++;
  }
  const out = [
    `diff --git a/${file} b/${file}`,
    `--- ${from === null ? '/dev/null' : `a/${file}`}`,
    `+++ ${to === null ? '/dev/null' : `b/${file}`}`,
  ];
  for (const [lo, hi] of hunks) {
    const part = ops.slice(lo, hi + 1);
    const ca = part.filter((o) => o[0] !== '+').length,
      cb = part.filter((o) => o[0] !== '-').length;
    out.push(`@@ -${ca ? at[lo].a : at[lo].a - 1},${ca} +${cb ? at[lo].b : at[lo].b - 1},${cb} @@`, ...part.map(([t, l]) => t + l));
  }
  return `${out.join('\n')}\n`;
}

// ---------------------------------------------------------------- code jobs through GitHub (no local checkout)
const enc = (branch: string) => encodeURI(branch);
async function treeOf(repo: string, branch: string, token: string) {
  const ref: any = await ghApi('GET', `repos/${repo}/git/ref/heads/${enc(branch)}`, { token });
  const tree: any = await ghApi('GET', `repos/${repo}/git/trees/${ref.object.sha}?recursive=1`, { token });
  return new Map<string, string>((tree.tree || []).filter((x: any) => x.type === 'blob').map((x: any) => [x.path, x.sha]));
}
async function blobText(repo: string, sha: string | undefined, token: string) {
  if (!sha) return null;
  const b: any = await ghApi('GET', `repos/${repo}/git/blobs/${sha}`, { token });
  return Buffer.from(b.content || '', b.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
}

/**
 * Compares a code job that ran through the AI API and GitHub. The default branch comes from GitHub's compare (the stored
 * diff when GitHub can't answer); another job's output is compared file by file, from the two branches' contents.
 */
export async function remoteCompare(
  j: any,
  target: CompareTarget,
  {
    token,
    defaultBranch,
    jobs,
    specAt = '',
    stored = '',
  }: { token: string; defaultBranch: string; jobs: any[]; specAt?: string; stored?: string },
) {
  if (target === 'default') {
    // Once merged, the default branch already has the change (a live comparison would be empty): show what was merged.
    if (j.status === 'merged') return compareResult(target, { against: `${defaultBranch} (before the merge)`, diff: stored });
    try {
      const c: any = await ghApi('GET', `repos/${j.repo}/compare/${enc(defaultBranch)}...${enc(j.branch)}`, { token });
      const diff = (c.files || [])
        .map((f: any) =>
          f.patch
            ? `diff --git a/${f.previous_filename || f.filename} b/${f.filename}\n--- ${f.status === 'added' ? '/dev/null' : `a/${f.previous_filename || f.filename}`}\n+++ ${f.status === 'removed' ? '/dev/null' : `b/${f.filename}`}\n${f.patch}\n`
            : `diff --git a/${f.filename} b/${f.filename}\nBinary files differ\n`,
        )
        .join('');
      return compareResult(target, { against: defaultBranch, diff });
    } catch {
      return compareResult(target, { against: defaultBranch, diff: stored });
    }
  }
  const prev = baseJobFor(j, jobs, target, specAt);
  if (!prev) return compareResult(target, { reason: noBaseReason(target, specAt) });
  const against = `${prev.ticketKey} run of ${String(prev.startedAt).slice(0, 16).replace('T', ' ')} (${prev.branch})`;
  try {
    const [from, to] = await Promise.all([treeOf(j.repo, prev.branch, token), treeOf(j.repo, j.branch, token)]);
    const paths = [...new Set([...(prev.files || []), ...(j.files || [])].map((f: any) => f.path))]
      .filter((p) => from.get(p) !== to.get(p))
      .sort()
      .slice(0, 60);
    const parts: string[] = [];
    for (const p of paths) parts.push(unifiedDiff(p, await blobText(j.repo, from.get(p), token), await blobText(j.repo, to.get(p), token)));
    return compareResult(target, { against, diff: parts.join('') });
  } catch (e: any) {
    return compareResult(target, {
      against,
      reason: `Couldn’t read the other run’s branch from GitHub (${e.message}). It may have been deleted.`,
    });
  }
}
