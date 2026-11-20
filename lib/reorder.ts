// Applying a suggested development order (lib/devorder.ts) to the backlog. Pure and
// dependency-free, so the browser (client/DevPlan.tsx) uses the same code the tests check.

/**
 * The project's ticket list with the given issues moved into the suggested order. They keep the
 * places they hold in the backlog now, so issues that aren't part of the plan don't move. Returns
 * the new list of ticket ids.
 */
export function applyOrder(allIds: string[], orderedIds: string[]) {
  const present = new Set(allIds);
  const queue = orderedIds.filter((id) => present.has(id));
  const set = new Set(queue);
  return allIds.map((id) => (set.has(id) ? (queue.shift() as string) : id));
}
