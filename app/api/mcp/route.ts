import { api, currentUser, body } from '@/lib/server/http';
import { handleMessage, rpcError } from '@/lib/mcp';

// The MCP server (Streamable HTTP, stateless): POST one JSON-RPC message (or a batch) with
// `Authorization: Bearer tfk_…`, an API token (made by a signed-in person with POST
// /api/me/tokens). The call acts as the token's person: their role decides what the tools may do
// and their project access what they can see. No valid token: 401 before anything else is read, and
// no tool runs. There is no server-to-client stream and no session, so GET and DELETE are refused
// (405).
const UNAUTHORIZED = {
  status: 401,
  headers: { 'WWW-Authenticate': 'Bearer realm="ticketforge", error="invalid_token"' },
};

export const POST = api(
  async (req) => {
    const user = await currentUser();
    if (!user)
      return Response.json(
        { error: 'Send a valid API token as “Authorization: Bearer <token>”.' },
        UNAUTHORIZED,
      );
    const msg = await body(req);
    if (msg === null || typeof msg !== 'object' || (Array.isArray(msg) && !msg.length))
      return Response.json(
        rpcError(null, Array.isArray(msg) ? -32600 : -32700, 'Send one JSON-RPC 2.0 message.'),
        { status: 400 },
      );
    const out: any[] = [];
    for (const m of Array.isArray(msg) ? msg : [msg]) {
      const r = await handleMessage(user, m);
      if (r) out.push(r);
    }
    // Only notifications and responses came in: nothing to send back.
    if (!out.length) return new Response(null, { status: 202 });
    return Response.json(Array.isArray(msg) ? out : out[0]);
  },
  { bearer: true },
);

const NOT_ALLOWED = api(
  async () => {
    const user = await currentUser();
    if (!user)
      return Response.json(
        { error: 'Send a valid API token as “Authorization: Bearer <token>”.' },
        UNAUTHORIZED,
      );
    return Response.json(
      { error: 'This MCP server only accepts POST.' },
      { status: 405, headers: { Allow: 'POST' } },
    );
  },
  { bearer: true },
);
export const GET = NOT_ALLOWED;
export const DELETE = NOT_ALLOWED;
