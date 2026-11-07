import { api, authed } from '@/lib/server/http';
import { listNotifications } from '@/lib/notify.js';

export const GET = api(async () => listNotifications((await authed()).id));
