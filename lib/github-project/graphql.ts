// GitHub Projects (the boards at github.com/…/projects/N) are only reachable through GitHub's
// GraphQL API. One call here: a readable error for a missing permission, a rate limit or no reply.
import { HttpError } from '../auth';

export const NEEDS_PROJECT_SCOPE =
  'The GitHub token can’t use GitHub Projects. Use a classic token with the “project” scope (or a fine-grained token with Projects access) in Project settings → Code & GitHub.';

function explain(errors: any[]) {
  const first = errors[0] || {};
  if (errors.some((e) => e.type === 'INSUFFICIENT_SCOPES' || e.type === 'FORBIDDEN'))
    return new HttpError(400, NEEDS_PROJECT_SCOPE);
  if (errors.some((e) => e.type === 'RATE_LIMITED'))
    return new HttpError(429, 'GitHub’s rate limit is used up. Try again later.');
  if (first.type === 'NOT_FOUND')
    return new HttpError(400, 'That GitHub Project wasn’t found, or the token can’t see it.');
  return new HttpError(502, `GitHub said: ${String(first.message || 'an unknown error')}`);
}

/** A mutation in a GraphQL document (any operation, after comments are left out). */
const MUTATION = /(^|[\s}])mutation\b/;
const isMutation = (query: string) => MUTATION.test(String(query).replace(/#[^\n]*/g, ''));

/**
 * Runs one GraphQL query and returns its `data`. GraphQL always goes over POST, so this refuses any
 * document with a mutation: Ticket Forge only reads from GitHub, and nothing here can write to it.
 */
export async function gql(token: string, query: string, variables: any = {}) {
  if (isMutation(query))
    throw new HttpError(400, 'Ticket Forge only reads from GitHub: GitHub mutations aren’t sent.');
  let res: Response;
  try {
    res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'TicketForge',
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new HttpError(504, 'GitHub didn’t respond. Try again.');
  }
  if (res.status === 401)
    throw new HttpError(400, 'GitHub rejected the sign-in. Connect GitHub again.');
  const json: any = await res.json().catch(() => ({}));
  if (json.errors?.length) throw explain(json.errors);
  if (!res.ok) throw new HttpError(502, `GitHub said ${res.status}.`);
  return json.data;
}
