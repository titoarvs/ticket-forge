import { tx, q } from '../db';
import { HttpError } from '../auth';
import { describeSection } from '../activity';
import { duplicateStatus } from '../workflow';
import {
  NOT_META,
  has,
  same,
  META_PERM,
  NO_DRAFT_TITLE,
  PRIORITIES,
  statsOf,
  noteVersion,
} from './create-project';
import { keepSystemEntries, ticketNeeds, stamp } from './append-comment';

/**
 * patch = { meta: { section: value }, upsert: [ticket], remove: [id], order: [id],
 *           baseRevs: { issueId: rev }, metaRevs: { section: rev } }
 * baseRevs / metaRevs: the version of each issue and section the browser started from. When someone
 * saved it since, nothing is saved and the answer is 409 with their copies (conflict), so the
 * browser merges both people's changes and saves again: no edit is silently overwritten. Returns {
 * version, revs }.
 */
export async function patchProject(id, patch, user) {
  const meta = patch.meta && typeof patch.meta === 'object' ? patch.meta : {};
  const metaKeys = Object.keys(meta).filter((k) => !NOT_META.has(k));
  const baseRevs = patch.baseRevs && typeof patch.baseRevs === 'object' ? patch.baseRevs : null;
  const metaRevs = patch.metaRevs && typeof patch.metaRevs === 'object' ? patch.metaRevs : null;
  let notes: any[] = []; // assignee / priority changes to notify about once the save is in
  const out = await tx(async (t) => {
    notes = [];
    // The new version first: this takes the project's row lock, so saves of one project queue here
    // and each one reads what the previous one wrote (no lost updates). Only the sections being
    // saved are read.
    const pr = (
      await t.query(
        `update projects set version = version + 1, updated_at = now() where id = $1 and archived_at is null
      returning version, name, key, revs, (select coalesce(jsonb_object_agg(k, data -> k), '{}'::jsonb) from unnest($2::text[]) as k) as old`,
        [id, metaKeys],
      )
    ).rows[0];
    if (!pr) throw new HttpError(404, 'Project not found');
    const version = pr.version,
      revs = pr.revs || {},
      old = pr.old || {};
    const touched = [
      ...new Set(
        [...(patch.upsert || []).map((tk) => tk?.id), ...(patch.remove || [])].filter(
          (x) => typeof x === 'string',
        ),
      ),
    ];
    const ordered = Array.isArray(patch.order);
    // Positions of every issue only when the order changes; otherwise just the issues being saved.
    const rows = ordered
      ? (
          await t.query(
            'select id, position, rev, case when id = any($2) then data end as data from issues where project_id = $1',
            [id, touched],
          )
        ).rows
      : touched.length
        ? (
            await t.query(
              'select id, position, rev, data from issues where project_id = $1 and id = any($2)',
              [id, touched],
            )
          ).rows
        : [];
    const current: any = new Map(rows.map((r) => [r.id, r]));
    const missing: Set<any> = new Set();
    const need = (alts) => {
      if (!alts.some((p) => has(user, p))) missing.add(alts[0]);
    };

    const changedMeta = metaKeys.filter(
      (k) =>
        !same(old[k], meta[k]) ||
        (k === 'name' && meta[k] !== pr.name) ||
        (k === 'key' && meta[k] !== pr.key),
    );
    for (const k of changedMeta) need(META_PERM[k] || ['project.settings']);
    // A saved workflow can't use a status name twice (the flow isn't saved).
    if (changedMeta.includes('workflow')) {
      const dup = duplicateStatus(meta.workflow);
      if (dup)
        throw new HttpError(
          400,
          `The status name “${dup}” is a duplicate. Names must be unique in a project.`,
        );
    }
    // Publishing an epic draft (its draft flag removed) needs a title.
    if (changedMeta.includes('epics')) {
      const was = new Map((Array.isArray(old.epics) ? old.epics : []).map((e: any) => [e?.id, e]));
      if (
        (Array.isArray(meta.epics) ? meta.epics : []).some(
          (e: any) =>
            e && (was.get(e.id) as any)?.draft && !e.draft && !String(e.title || '').trim(),
        )
      )
        throw new HttpError(400, NO_DRAFT_TITLE);
    }
    const upserts = (patch.upsert || [])
      .filter((tk) => tk && typeof tk.id === 'string')
      .map((tk) => keepSystemEntries(current.get(tk.id)?.data, tk));
    for (const tk of upserts) ticketNeeds(current.get(tk.id)?.data, tk, user).forEach(need);
    // Changed story points must be a number and a changed priority one of the existing values.
    for (const tk of upserts) {
      const prev = current.get(tk.id)?.data;
      if (!prev) continue;
      const sp = tk.storyPoints;
      if (
        !same(prev.storyPoints, sp) &&
        sp != null &&
        !(typeof sp === 'number' && Number.isFinite(sp) && sp >= 0)
      )
        throw new HttpError(400, `Story points must be a number (${tk.key || 'issue'}).`);
      if (!same(prev.priority, tk.priority) && !PRIORITIES.includes(tk.priority))
        throw new HttpError(
          400,
          `Priority must be one of ${PRIORITIES.join(', ')} (${tk.key || 'issue'}).`,
        );
      // Who to tell: the new assignee, or the current one when only the priority changed (see
      // notifyIssueChanges).
      const assigneeChanged = !same(prev.assignee || '', tk.assignee || '');
      if (tk.assignee && (assigneeChanged || !same(prev.priority, tk.priority))) {
        notes.push({
          issueId: tk.id,
          key: tk.key,
          title: tk.title,
          assignee: tk.assignee,
          assigneeChanged,
          priority: tk.priority,
        });
      }
    }
    const removes = (patch.remove || []).filter((rid) => current.has(rid));
    if (removes.length) need(['issue.delete']);
    if (ordered) {
      const known = [...current.values()]
        .sort((a: any, b: any) => a.position - b.position)
        .map((r: any) => r.id)
        .filter((x) => patch.order.includes(x));
      const asked = patch.order.filter((x) => current.has(x));
      if (!same(known, asked)) need(['issue.edit', 'sprint.manage', 'epic.manage']);
    }
    if (missing.size)
      throw new HttpError(
        403,
        `You don't have permission to save these changes (${[...missing].join(', ')}). Ask an administrator for access.`,
      );

    // Conflicts: someone saved an issue or section after this browser loaded it.
    if (baseRevs || metaRevs) {
      const tickets = [],
        deleted = [],
        issueRevs = {};
      for (const tk of upserts) {
        const base = baseRevs?.[tk.id];
        if (typeof base !== 'number') continue;
        const cur: any = current.get(tk.id);
        if (!cur) deleted.push(tk.id);
        else if (cur.rev > base) {
          tickets.push(cur.data);
          issueRevs[tk.id] = cur.rev;
        }
      }
      const sections = {},
        sectionRevs = {};
      for (const k of changedMeta) {
        const base = metaRevs?.[k];
        if (typeof base === 'number' && (revs[k] || 0) > base) {
          sections[k] = old[k];
          sectionRevs[k] = revs[k];
        }
      }
      if (tickets.length || deleted.length || Object.keys(sections).length) {
        const e: any = new HttpError(409, 'Someone else saved these issues a moment ago.');
        e.extra = {
          conflict: {
            tickets,
            deleted,
            meta: sections,
            revs: { issues: issueRevs, meta: sectionRevs },
          },
        };
        throw e;
      }
    }

    // apply: only what changed is written (a big project's settings aren't rewritten for one
    // issue's change)
    if (changedMeta.length) {
      const set = {},
        setRevs = {};
      for (const k of changedMeta) {
        set[k] = meta[k] === undefined ? null : meta[k];
        setRevs[k] = version;
      }
      const name = changedMeta.includes('name') ? String(meta.name || pr.name) : pr.name;
      const key = changedMeta.includes('key') ? String(meta.key || pr.key) : pr.key;
      const stats = changedMeta.includes('epics') ? JSON.stringify(statsOf(meta)) : null;
      await t.query(
        'update projects set data = data || $2::jsonb, revs = revs || $3::jsonb, name = $4, key = $5, stats = coalesce($6::jsonb, stats) where id = $1',
        [id, JSON.stringify(set), JSON.stringify(setRevs), name, key, stats],
      );
    }
    const orderIndex = new Map((patch.order || []).map((x, i) => [x, i]));
    const fresh = upserts.filter((tk) => !current.has(tk.id));
    let maxPos = -1;
    if (ordered) maxPos = Math.max(-1, ...rows.map((r) => r.position));
    else if (fresh.length)
      maxPos = Number(
        (
          await t.query(
            'select coalesce(max(position), -1) as m from issues where project_id = $1',
            [id],
          )
        ).rows[0].m,
      );
    // One statement each for all upserts, deletes and position changes, however many issues
    // changed.
    if (upserts.length) {
      const list = upserts.map((tk) => {
        const prev: any = current.get(tk.id);
        return {
          id: tk.id,
          pos: orderIndex.has(tk.id) ? orderIndex.get(tk.id) : prev ? prev.position : ++maxPos,
          data: stamp(prev?.data, { ...tk }, user),
        };
      });
      await t.query(
        `insert into issues (project_id, id, position, data, updated_by, updated_at, rev)
        select $1, x.id, x.pos, x.data, $3, now(), $4 from jsonb_to_recordset($2::jsonb) as x(id text, pos float8, data jsonb)
        on conflict (project_id, id) do update set data = excluded.data, position = excluded.position, updated_by = excluded.updated_by, updated_at = now(), rev = excluded.rev`,
        [id, JSON.stringify(list), user.id, version],
      );
      if (fresh.length)
        await t.query('delete from issue_tombstones where project_id = $1 and id = any($2)', [
          id,
          fresh.map((tk) => tk.id),
        ]);
      // A status change saves the whole issue as a new version (edits that keep the status don't).
      const moved = list.filter((x) => {
        const prev = current.get(x.id)?.data;
        return prev && !same(prev.status, x.data.status);
      });
      if (moved.length)
        await insertVersions(
          t,
          id,
          moved.map((x) => ({ id: x.id, data: x.data })),
          user,
        );
    }
    if (removes.length) {
      await t.query('delete from issue_versions where project_id = $1 and issue_id = any($2)', [
        id,
        removes,
      ]);
      await t.query('delete from issues where project_id = $1 and id = any($2)', [id, removes]);
      await t.query(
        `insert into issue_tombstones (project_id, id, rev) select $1, x, $3 from unnest($2::text[]) as x
        on conflict (project_id, id) do update set rev = excluded.rev`,
        [id, removes, version],
      );
    }
    let orderChanged = fresh.length > 0 && ordered;
    if (ordered) {
      const moves = [...orderIndex]
        .filter(
          ([x, i]) =>
            current.has(x) && current.get(x).position !== i && !upserts.some((u) => u.id === x),
        )
        .map(([x, i]) => ({ id: x, pos: i }));
      if (moves.length) {
        orderChanged = true;
        await t.query(
          `update issues i set position = x.pos from jsonb_to_recordset($2::jsonb) as x(id text, pos float8)
          where i.project_id = $1 and i.id = x.id`,
          [id, JSON.stringify(moves)],
        );
      }
      if (!orderChanged)
        orderChanged = upserts.some(
          (u) =>
            current.has(u.id) &&
            orderIndex.has(u.id) &&
            current.get(u.id).position !== orderIndex.get(u.id),
        );
    }
    if (orderChanged)
      await t.query(
        "update projects set revs = revs || jsonb_build_object('_order', $2::int) where id = $1",
        [id, version],
      );
    // The project timeline: changes to sections (sprints, epics, releases, settings…) and deleted
    // issues. Issue changes are already in each issue's history.
    const events = [
      ...changedMeta.flatMap((k) => describeSection(k, old[k], meta[k])),
      ...removes.map((rid) => {
        const d = current.get(rid)?.data || {};
        return {
          kind: 'issue',
          text: `deleted issue ${d.key || ''}${d.title ? ` “${String(d.title).slice(0, 120)}”` : ''}`.trim(),
          target: d.key || '',
        };
      }),
    ];
    if (events.length) {
      const list =
        events.length > 25
          ? [
              ...events.slice(0, 24),
              { kind: 'project', text: `and ${events.length - 24} more changes`, target: '' },
            ]
          : events;
      await t.query(
        `insert into activity (project_id, version, user_id, author, kind, target, text)
        select $1, $2, $3, $4, x.kind, x.target, x.text from jsonb_to_recordset($5::jsonb) as x(kind text, target text, text text)`,
        [id, version, user.id, user.name || '', JSON.stringify(list)],
      );
    }
    const outRevs = { issues: {}, meta: {} };
    for (const tk of upserts) outRevs.issues[tk.id] = version;
    for (const k of metaKeys) outRevs.meta[k] = changedMeta.includes(k) ? version : revs[k] || 0;
    return { version, revs: outRevs };
  });
  noteVersion(id, out.version);
  if (notes.length) {
    // The save is done: a failed notification must not undo or fail it.
    try {
      await (
        await import('../notify')
      ).notifyIssueChanges({ projectId: id, actor: user, changes: notes });
    } catch (e) {
      console.error('Could not send issue notifications', e);
    }
  }
  return out;
}
// ---------------------------------------------------------------- issue versions
/**
 * What a version keeps: every field of the issue except its activity (comments and the change
 * history). Those keep growing, and a restore must not take comments away.
 */
export const versionFields = (d) => {
  const { comments: _c, history: _h, ...rest } = d || {};
  return rest;
};
/**
 * Saves issues as their next version number (inside the save's transaction, which holds the project
 * lock).
 */
export async function insertVersions(t, projectId, items, user, restoredFrom = null) {
  const rows = items.map((x) => ({
    id: x.id,
    status: String(x.data.status ?? ''),
    data: versionFields(x.data),
  }));
  await t.query(
    `insert into issue_versions (project_id, issue_id, number, user_id, author, status, restored_from, data)
    select $1, x.id, coalesce((select max(v.number) from issue_versions v where v.project_id = $1 and v.issue_id = x.id), 0) + 1, $2, $3, x.status, $5::int, x.data
    from jsonb_to_recordset($4::jsonb) as x(id text, status text, data jsonb)`,
    [projectId, user?.id || null, user?.name || '', JSON.stringify(rows), restoredFrom],
  );
}
/** An issue's versions, newest first: { number, at, author, status, restoredFrom, data }. */
export async function listVersions(projectId, issueId) {
  const { rows } = await q(
    `select number, at, author, status, restored_from as "restoredFrom", data from issue_versions
    where project_id = $1 and issue_id = $2 order by number desc limit 500`,
    [projectId, issueId],
  );
  return rows;
}
