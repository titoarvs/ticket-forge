import { has } from '../store';
import {
  MAX_LIMIT,
  DEFAULT_LIMIT,
  TITLE_MAX,
  TYPES,
  PRIORITIES,
  createIssue,
  listIssues,
  getIssue,
  listEpics,
  getEpic,
  bad,
  PROTOCOL_VERSIONS,
  SERVER_INFO,
} from './create-issue';

// ---------------------------------------------------------------- tool catalogue
const str = (description: string) => ({ type: 'string', description });
const projectId = str('The id of the project.');
const pagingProps = {
  limit: {
    type: 'integer',
    minimum: 1,
    maximum: MAX_LIMIT,
    description: `How many to return (default ${DEFAULT_LIMIT}).`,
  },
  offset: { type: 'integer', minimum: 0, description: 'How many to skip, for the next page.' },
};
type Tool = {
  name: string;
  description: string;
  inputSchema: any;
  run: (user: any, args: any) => Promise<any>;
  needs?: string;
};
export const TOOLS: Tool[] = [
  {
    name: 'create_issue',
    description:
      'Create one issue in a project’s backlog. Needs the “Create issues” permission. The new issue gets the first workflow status.',
    needs: 'issue.create',
    inputSchema: {
      type: 'object',
      properties: {
        projectId,
        title: str(`The issue’s title (up to ${TITLE_MAX} characters).`),
        type: { type: 'string', enum: TYPES, description: 'Default Story.' },
        priority: { type: 'string', enum: PRIORITIES, description: 'Default Medium.' },
        description: str('What the issue is about.'),
        userStory: str('“As a …, I want …, so that …”.'),
        acceptanceCriteria: {
          type: 'array',
          items: { type: 'string' },
          description: 'One item per criterion.',
        },
        labels: { type: 'array', items: { type: 'string' } },
        storyPoints: { type: 'number', minimum: 0 },
        epicId: str('The id of an epic of this project to put the issue in.'),
      },
      required: ['projectId', 'title'],
      additionalProperties: false,
    },
    run: createIssue,
  },
  {
    name: 'list_issues',
    description:
      'List or search the issues of a project. “query” searches key, title, user story and description.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId,
        query: str('Text to look for.'),
        status: str('Only issues with this status.'),
        type: str('Only issues of this type.'),
        priority: str('Only issues with this priority.'),
        assignee: str('Only issues assigned to this person (as named on the issue).'),
        epicId: str('Only issues in this epic.'),
        ...pagingProps,
      },
      required: ['projectId'],
      additionalProperties: false,
    },
    run: listIssues,
  },
  {
    name: 'get_issue',
    description: 'Read one issue of a project by its id or key (for example SH-12).',
    inputSchema: {
      type: 'object',
      properties: { projectId, issueId: str('The issue’s id or key.') },
      required: ['projectId', 'issueId'],
      additionalProperties: false,
    },
    run: getIssue,
  },
  {
    name: 'list_epics',
    description:
      'List or search the epics of a project. “query” searches key, title and description.',
    inputSchema: {
      type: 'object',
      properties: { projectId, query: str('Text to look for.'), ...pagingProps },
      required: ['projectId'],
      additionalProperties: false,
    },
    run: listEpics,
  },
  {
    name: 'get_epic',
    description: 'Read one epic of a project by its id or key, with its issues.',
    inputSchema: {
      type: 'object',
      properties: { projectId, epicId: str('The epic’s id or key.') },
      required: ['projectId', 'epicId'],
      additionalProperties: false,
    },
    run: getEpic,
  },
];
/** The tools this person may use (create_issue is left out for a role without issue.create). */
export const toolsFor = (user) =>
  TOOLS.filter((t) => !t.needs || has(user, t.needs)).map(({ run: _r, needs: _n, ...t }) => t);
/**
 * Runs one tool as `user`. Throws HttpError (400 validation, 403 permission, 404 project or item
 * not found).
 */
export async function callTool(user, name: string, args: any) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw bad(`Unknown tool “${String(name).slice(0, 64)}”.`);
  if (args != null && (typeof args !== 'object' || Array.isArray(args)))
    throw bad('The tool arguments must be an object.');
  return tool.run(user, args || {});
}
// ---------------------------------------------------------------- JSON-RPC
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
export const rpcError = (id, code, message) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message },
});
const CODE = { 400: 'validation_error', 403: 'permission_denied', 404: 'not_found' };
/**
 * Answers one JSON-RPC message as `user`: the response object, or null for a notification (nothing
 * to send back).
 * A tool that is refused (validation, permission, no access) is a normal result with isError, as
 * MCP defines for tool errors; the structured error carries the HTTP-style status.
 */
export async function handleMessage(user, msg: any) {
  // A client's answer to a server request: this server sends none, so there is nothing to do.
  if (
    msg &&
    typeof msg === 'object' &&
    msg.method === undefined &&
    ('result' in msg || 'error' in msg)
  )
    return null;
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string')
    return rpcError(msg?.id, -32600, 'Invalid request.');
  const isNotification = msg.id === undefined || msg.id === null;
  const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
  switch (msg.method) {
    case 'initialize':
      return rpcResult(msg.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(params.protocolVersion)
          ? params.protocolVersion
          : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'Create, list, search and read issues and epics of Ticket Forge projects. Every call acts as the person the token belongs to.',
      });
    case 'ping':
      return rpcResult(msg.id, {});
    case 'tools/list':
      return rpcResult(msg.id, { tools: toolsFor(user) });
    case 'tools/call': {
      if (typeof params.name !== 'string' || !TOOLS.some((t) => t.name === params.name))
        return rpcError(msg.id, -32602, `Unknown tool “${String(params.name).slice(0, 64)}”.`);
      try {
        const out = await callTool(user, params.name, params.arguments);
        return rpcResult(msg.id, {
          content: [{ type: 'text', text: JSON.stringify(out) }],
          structuredContent: out,
          isError: false,
        });
      } catch (e: any) {
        if (!e.status || e.status >= 500) throw e;
        const error = { status: e.status, code: CODE[e.status] || 'error', message: e.message };
        return rpcResult(msg.id, {
          content: [{ type: 'text', text: `${error.code}: ${error.message}` }],
          structuredContent: { error },
          isError: true,
        });
      }
    }
    default:
      // Notifications (such as notifications/initialized) need no answer; an unknown request does.
      return isNotification
        ? null
        : rpcError(msg.id, -32601, `Method not found: ${msg.method.slice(0, 64)}`);
  }
}
