import { api } from '@/lib/server/http';
import * as auth from '@/lib/auth';

export const GET = api(async (_req, p) => auth.inviteInfo(p.token));
