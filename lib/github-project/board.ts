// Reading and writing a GitHub Project board: the boards a repository can use, a board's fields
// (the ones Ticket Forge maps: Status, Priority, story points, the sprint iteration), its items
// with their values, adding an issue to it and setting an item's fields.
import { gql } from './graphql';
import { BOARDS, BOARD, ITEMS, ADD_ITEM, setFieldsMutation } from './queries';

const MAX_ITEM_PAGES = 20;

export type Field = { id: string; name: string; options?: { id: string; name: string }[] };
export type Board = {
  id: string;
  number: number;
  title: string;
  url: string;
  fields: { status?: Field; priority?: Field; points?: Field; sprint?: Field };
};
/** An item's values in GitHub's terms: option names, a number, an iteration title. */
export type Values = { status: string; priority: string; points: number | null; sprint: string };
export type Item = { id: string; updatedAt: string; values: Values };

const boardOut = (b: any) => ({
  id: b.id,
  number: b.number,
  title: b.title,
  url: b.url,
  closed: Boolean(b.closed),
});

/** The open boards of `owner/name` and of its owner, newest number first, without duplicates. */
export async function listBoards(token: string, repo: string) {
  const [owner, name] = repo.split('/');
  const d = await gql(token, BOARDS, { owner, name });
  const all = [
    ...(d?.repository?.projectsV2?.nodes || []),
    ...(d?.repositoryOwner?.projectsV2?.nodes || []),
  ].filter(Boolean);
  const seen = new Map(all.map((b: any) => [b.id, boardOut(b)]));
  return [...seen.values()].filter((b) => !b.closed).sort((a, b) => b.number - a.number);
}

const pick = (fields: any[], type: string, test: RegExp) =>
  fields.find((f) => f.__typename === type && test.test(f.name));

/** The board and the fields Ticket Forge maps (each may be missing). */
export async function readBoard(token: string, id: string): Promise<Board> {
  const d = await gql(token, BOARD, { id });
  const b = d?.node;
  if (!b?.id) throw Object.assign(new Error('That GitHub Project wasn’t found.'), { status: 400 });
  const all = b.fields?.nodes || [];
  const sprint =
    pick(all, 'ProjectV2IterationField', /sprint|iteration/i) ||
    all.find((f: any) => f.__typename === 'ProjectV2IterationField');
  const field = (f: any, options?: any[]) =>
    f && { id: f.id, name: f.name, ...(options ? { options } : {}) };
  const iterations = sprint
    ? [
        ...(sprint.configuration?.iterations || []),
        ...(sprint.configuration?.completedIterations || []),
      ]
    : undefined;
  const status = pick(all, 'ProjectV2SingleSelectField', /^status$/i);
  const priority = pick(all, 'ProjectV2SingleSelectField', /priority/i);
  const numbers = all.filter((f: any) => f.dataType === 'NUMBER');
  const points =
    numbers.find((f: any) => /^(story ?points|points|estimate|size|sp)$/i.test(f.name)) ||
    numbers.find((f: any) => /point|estimate/i.test(f.name));
  return {
    ...boardOut(b),
    fields: {
      status: field(status, status?.options),
      priority: field(priority, priority?.options),
      points: field(points),
      sprint: field(
        sprint,
        iterations?.map((i: any) => ({ id: i.id, name: i.title })),
      ),
    },
  };
}

/** An item's values for the mapped fields, read by field id. */
function valuesOf(board: Board, nodes: any[]): Values {
  const by = (f?: Field) => nodes.find((v) => f && v.field?.id === f.id);
  const f = board.fields;
  const points = by(f.points)?.number;
  return {
    status: by(f.status)?.name || '',
    priority: by(f.priority)?.name || '',
    points: typeof points === 'number' ? points : null,
    sprint: by(f.sprint)?.title || '',
  };
}

/** The board's items that are issues of `repo`, by issue number. */
export async function readItems(token: string, board: Board, repo: string) {
  const out = new Map<number, Item>();
  let after: string | null = null;
  for (let page = 0; page < MAX_ITEM_PAGES; page++) {
    const d = await gql(token, ITEMS, { id: board.id, after });
    const items = d?.node?.items;
    for (const n of items?.nodes || []) {
      const c = n?.content;
      if (c?.__typename !== 'Issue' || c.repository?.nameWithOwner !== repo) continue;
      out.set(Number(c.number), {
        id: n.id,
        updatedAt: n.updatedAt,
        values: valuesOf(board, n.fieldValues?.nodes || []),
      });
    }
    if (!items?.pageInfo?.hasNextPage) break;
    after = items.pageInfo.endCursor;
  }
  return out;
}

/** Adds an issue (its GraphQL node id) to the board; returns the new item, empty. */
export async function addItem(token: string, board: Board, contentId: string): Promise<Item> {
  const d = await gql(token, ADD_ITEM, { project: board.id, content: contentId });
  const item = d?.addProjectV2ItemById?.item;
  return {
    id: item.id,
    updatedAt: item.updatedAt,
    values: { status: '', priority: '', points: null, sprint: '' },
  };
}

/** Writes values (GitHub's terms) to an item; a value that can't be found on the board is skipped. */
export async function setValues(
  token: string,
  board: Board,
  itemId: string,
  values: Partial<Values>,
) {
  const f = board.fields;
  const option = (field: Field | undefined, name: string) =>
    field?.options?.find((o) => o.name === name)?.id;
  const changes: { fieldId: string; value: any }[] = [];
  const add = (field: Field | undefined, value: any) =>
    field && changes.push({ fieldId: field.id, value });
  if ('status' in values && values.status) {
    const id = option(f.status, values.status);
    if (id) add(f.status, { singleSelectOptionId: id });
  }
  if ('priority' in values && values.priority) {
    const id = option(f.priority, values.priority);
    if (id) add(f.priority, { singleSelectOptionId: id });
  }
  if ('points' in values) add(f.points, values.points == null ? null : { number: values.points });
  if ('sprint' in values) {
    const id = values.sprint ? option(f.sprint, values.sprint) : null;
    if (id || !values.sprint) add(f.sprint, id ? { iterationId: id } : null);
  }
  if (!changes.length) return;
  const vars: any = { project: board.id, item: itemId };
  changes.forEach((c, i) => {
    vars[`f${i}`] = c.fieldId;
    if (c.value) vars[`v${i}`] = c.value;
  });
  await gql(token, setFieldsMutation(changes), vars);
}
