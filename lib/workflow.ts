// TF-141: checks on a project's workflow (its statuses). No database here, so tests can import it.

/**
 * The first status name a workflow uses twice (ignoring case and spaces at the ends), or ''.
 * Status names must be unique within a project.
 */
export function duplicateStatus(workflow: any): string {
  const seen = new Set<string>();
  for (const w of Array.isArray(workflow) ? workflow : []) {
    const name = String(w?.name ?? '').trim();
    if (seen.has(name.toLowerCase())) return name;
    seen.add(name.toLowerCase());
  }
  return '';
}
