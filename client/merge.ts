// Three-way merge for teammates' changes: base = what this browser last got from the server, mine = it now (with
// unsaved edits), theirs = the server's copy now. Whatever only one side changed is kept; lists of things with an id
// (comments, history, test cases, epics, sprints…) are merged item by item, so two people commenting on the same
// issue, or editing different epics, both keep their work. When both changed the same value, this person's wins
// (it's what they are saving now).

type Any = any;
const J = (x: Any) => JSON.stringify(x === undefined ? null : x);
const isObj = (x: Any) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isIdList = (x: Any) => Array.isArray(x) && x.every((v) => isObj(v) && typeof v.id === 'string');
const isPrimList = (x: Any) => Array.isArray(x) && x.every((v) => v === null || typeof v !== 'object');

function mergeById(base: Any[], mine: Any[], theirs: Any[]) {
  const B = new Map(base.map((x) => [x.id, x])),
    M = new Map(mine.map((x) => [x.id, x])),
    T = new Map(theirs.map((x) => [x.id, x]));
  const out: Any[] = [];
  for (const t of theirs) {
    const b = B.get(t.id),
      m = M.get(t.id);
    if (m !== undefined) out.push(merge3(b, m, t));
    else if (b === undefined)
      out.push(t); // added by them
    else if (J(t) !== J(b)) out.push(t); // I removed it but they changed it: keep their version
    // else: I removed it and they didn't touch it
  }
  for (const m of mine) {
    if (T.has(m.id)) continue;
    const b = B.get(m.id);
    if (b === undefined || J(m) !== J(b)) out.push(m); // added by me, or they removed it while I changed it
    // else: they removed it and I didn't touch it
  }
  return out;
}

function mergeSet(base: Any[], mine: Any[], theirs: Any[]) {
  const key = (v: Any) => J(v);
  const b = new Set(base.map(key)),
    m = new Set(mine.map(key));
  const removed = new Set([...b].filter((k) => !m.has(k)));
  const out = theirs.filter((v) => !removed.has(key(v)));
  const have = new Set(out.map(key));
  for (const v of mine)
    if (!b.has(key(v)) && !have.has(key(v))) {
      out.push(v);
      have.add(key(v));
    }
  return out;
}

export function merge3(base: Any, mine: Any, theirs: Any): Any {
  const b = J(base),
    m = J(mine),
    t = J(theirs);
  if (m === t || m === b) return theirs;
  if (t === b) return mine;
  if (Array.isArray(mine) && Array.isArray(theirs)) {
    const bl = Array.isArray(base) ? base : [];
    if (isIdList(bl) && isIdList(mine) && isIdList(theirs)) return mergeById(bl, mine, theirs);
    if (isPrimList(bl) && isPrimList(mine) && isPrimList(theirs)) return mergeSet(bl, mine, theirs);
    return mine;
  }
  if (isObj(mine) && isObj(theirs)) {
    const bo = isObj(base) ? base : {};
    const out: Any = {};
    for (const k of new Set([...Object.keys(bo), ...Object.keys(mine), ...Object.keys(theirs)])) {
      const v =
        k === 'updatedAt' && typeof mine[k] === 'string' && typeof theirs[k] === 'string'
          ? mine[k] > theirs[k]
            ? mine[k]
            : theirs[k]
          : merge3(bo[k], mine[k], theirs[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return mine;
}
