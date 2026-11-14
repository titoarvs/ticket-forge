import { api, currentUser } from '@/lib/server/http';
import * as auth from '@/lib/auth.js';
import { dbInfo } from '@/lib/db.js';
import { PERMISSIONS } from '@/lib/permissions.js';
import { getPrefs } from '@/lib/prefs.js';
import { signupMode, isSaas } from '@/lib/platform.js';

export const GET = api(async () => {
  const u = await currentUser();
  return {
    user: auth.publicUser(u),
    setupRequired: (await auth.userCount()) === 0,
    permissions: PERMISSIONS,
    emailConfigured: auth.emailConfig().configured,
    database: dbInfo.label,
    signupMode: signupMode(),
    saas: isSaas(),
    legal: u ? auth.legalStatus(u) : null,
    prefs: u ? await getPrefs(u.id) : null,
    workspaces: u ? await auth.listMyWorkspaces(u.id) : [],
  };
});
