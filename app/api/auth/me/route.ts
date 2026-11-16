import { api, currentUser, runsThePlatform } from '@/lib/server/http';
import { lockStatus } from '@/lib/limits.js';
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
    // Whether the workspace is locked after an unpaid trial (the app shows a pay prompt), and who may set up gateways and plans.
    billing: u ? await lockStatus(u.workspace_id) : { locked: false },
    canManageBilling: runsThePlatform(u),
    legal: u ? auth.legalStatus(u) : null,
    prefs: u ? await getPrefs(u.id) : null,
    workspaces: u ? await auth.listMyWorkspaces(u.id) : [],
  };
});
