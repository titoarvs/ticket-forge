// MCP server (Model Context Protocol, Streamable HTTP, stateless): lets third-party clients create,
// read and search a project's issues and epics. Every call acts as the person the API token belongs
// to (lib/auth.ts apiTokenUser), and every tool checks, on the server, that the project is in that
// person's workspace and on their access list, and that their role allows the action (issue.create
// to create; reading needs project access only, like the AI helper's search).
// A project the person can't open answers like one that doesn't exist, and nothing about it is
// returned.
// Created issues go straight to the end of the backlog (first workflow status, no sprint), with a
// history and a project timeline entry. The transport is in app/api/mcp/route.ts; the tools are
// plain functions, so tests call them directly.

export {
  SERVER_INFO,
  createIssue,
  listIssues,
  getIssue,
  listEpics,
  getEpic,
} from './mcp/create-issue';
export { TOOLS, toolsFor, callTool, rpcError, handleMessage } from './mcp/tools';
