import { execFile } from 'node:child_process';
import { SERVERLESS } from '../db';
import { getAiSettings, publicAiSettings } from '../settings';
import { copilotInfo, COPILOT_MODELS } from '../copilot';
import { cacheStats } from '../aicache';
import { planUsage } from '../claudeusage';
import {
  normalizeRouting,
  AI_TASKS,
  TIERS,
  CLAUDE_TIER_DEFAULTS,
  API_TIER_HINTS,
  normalizeConfigs,
} from '../aitasks';
import {
  aiMode,
  apiChain,
  cooling,
  envConfig,
  cliInfo,
  health,
  isLocalRequest,
  budgetState,
  DEFAULT_CLI_MODEL,
  H,
  U,
  PROVIDERS,
  CLI_BIN,
  WORKDIR,
} from './ask-ai';

export async function accountFallbackOn() {
  try {
    return (await getAiSettings()).accountFallback !== false;
  } catch {
    return true;
  }
}
/** What the browser may see: never the key. */
const publicApi = (c) => ({
  id: c.id,
  label: c.label,
  kind: c.kind,
  model: c.model || null,
  baseUrl: c.baseUrl || null,
  keySet: Boolean(c.keySet),
  keyNames: c.keyNames || [],
  site: c.site || null,
  source: c.source,
  missing: c.missing,
  configured: c.configured,
  error: c.error,
});
const ENV_NAMES = {
  provider: 'AI_PROVIDER',
  key: 'AI_API_KEY',
  model: 'AI_MODEL',
  baseUrl: 'AI_BASE_URL',
};
const UI_NAMES = {
  provider: 'a provider',
  key: 'the API key',
  model: 'the model',
  baseUrl: 'the endpoint URL',
};
const list = (xs) =>
  xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0];
export function apiSetupMessage(c) {
  if (!c)
    return 'No AI API is set up for this address. An administrator can add one in Administration → AI.';
  if (c.error) return c.error;
  if (!c.id)
    return 'No AI API is set up for this address. An administrator can add one in Administration → AI, or open TicketForge on your own computer to use your Claude account.';
  if (c.source === 'env')
    return `${c.label} isn’t fully set up: set ${list(c.missing.map((m) => ENV_NAMES[m]))} in the server’s environment, or set it up in Administration → AI.`;
  return `${c.label} isn’t fully set up: add ${list(c.missing.map((m) => UI_NAMES[m]))} in Administration → AI.`;
}
/**
 * Which AI this request uses, every API in priority order with its health, and whether it's ready.
 * `details` adds account email and organization (admins).
 */
export async function providerStatus({ details = false, planFresh = false }: any = {}) {
  const mode = aiMode();
  const chainAll = await apiChain({ all: true });
  const usable = chainAll.filter((c) => c.enabled && c.configured);
  const active = usable.find((c) => !cooling(c.entryId)) || usable[0] || null;
  const cfg = active || chainAll[0] || envConfig();
  let account = null;
  if (mode === 'account') {
    const cli = await cliInfo();
    const acct = cli.available ? await accountStatus() : null;
    account = {
      cli,
      signedIn: Boolean(cli.available && acct?.loggedIn !== false),
      cooldown: health('account'),
      ...(acct
        ? details
          ? acct
          : { loggedIn: acct.loggedIn, subscriptionType: acct.subscriptionType || null }
        : {}),
    };
  }
  const aiSet = await getAiSettings().catch(() => ({}));
  const fallback = await accountFallbackOn();
  // Locally: the providers stand in while your Claude account is limited, signed out or not
  // installed.
  const accountLimited =
    mode === 'account' &&
    (Boolean(account?.cooldown) || !account?.signedIn) &&
    fallback &&
    usable.length > 0;
  const ready =
    mode === 'account'
      ? Boolean(account?.signedIn) || (fallback && usable.length > 0)
      : usable.length > 0;
  return {
    mode,
    ready,
    local: isLocalRequest(),
    forced: ['account', 'api'].includes(String(process.env.AI_MODE || '').toLowerCase()),
    serverless: SERVERLESS,
    // The monthly AI budget (shown in the AI menu when it's 80% used or more).
    budget: await (async () => {
      const r = normalizeRouting(aiSet.routing);
      const b = await budgetState(r);
      return b.limit ? { ...b, action: r.budget.action } : null;
    })(),
    ...(await (async () => {
      // Which AI answers next on this computer: Copilot (chosen, or standing in for a limited
      // Claude account), Claude, or an API.
      const cp = mode === 'account' ? await copilotInfo() : { available: false };
      const cpOk = cp.available && !cooling('copilot');
      if (mode === 'account' && aiSet.localEngine === 'copilot' && cpOk)
        return { label: 'GitHub Copilot', model: aiSet.copilotModel || 'default', switched: false };
      if (mode === 'account' && aiSet.localEngine === 'copilot' && !cpOk)
        return {
          label:
            !accountLimited && account?.signedIn
              ? 'Claude account'
              : active
                ? active.label
                : 'AI not set up',
          model: !accountLimited && account?.signedIn ? DEFAULT_CLI_MODEL : active?.model || null,
          switched: true,
        };
      if (mode === 'account' && accountLimited && aiSet.copilotBackup && cpOk)
        return { label: 'GitHub Copilot', model: aiSet.copilotModel || 'default', switched: true };
      return {
        label:
          mode === 'account' && !accountLimited
            ? 'Claude account'
            : active
              ? active.label
              : 'AI not set up',
        model: normalizeRouting(aiSet.routing).enabled
          ? 'per task'
          : mode === 'account' && !accountLimited
            ? DEFAULT_CLI_MODEL
            : active?.model || null,
        switched:
          mode === 'account'
            ? accountLimited
            : Boolean(active && usable[0] && active !== usable[0]),
      };
    })()),
    backups: Math.max(0, usable.length - 1),
    account,
    accountFallback: fallback,
    // GitHub Copilot as the local AI or Claude's backup (this computer only).
    copilot:
      mode === 'account'
        ? { ...(await copilotInfo()), cooldown: health('copilot'), models: COPILOT_MODELS }
        : null,
    // Your Claude plan's 5-hour and weekly limits (this computer only, when signed in to Claude
    // Code with a plan).
    planUsage:
      mode === 'account' && account?.signedIn
        ? await planUsage({ fresh: planFresh }).catch(() => null)
        : null,
    localEngine: aiSet.localEngine === 'copilot' ? 'copilot' : 'claude',
    copilotModel: aiSet.copilotModel || '',
    copilotBackup: Boolean(aiSet.copilotBackup),
    api: publicApi(cfg),
    // Admins get the full list; everyone else only names, models and health.
    apis: chainAll.map((c) =>
      details
        ? {
            ...publicApi(c),
            entryId: c.entryId,
            enabled: c.enabled,
            cooldown: health(c.entryId),
            active: c === active,
          }
        : {
            label: c.label,
            model: c.model || null,
            enabled: c.enabled,
            configured: c.configured,
            cooldown: health(c.entryId),
            active: c === active,
          },
    ),
    last: H.last,
    ...(details
      ? {
          settings: publicAiSettings(await getAiSettings().catch(() => null)),
          tasks: AI_TASKS,
          tiers: TIERS,
          claudeTiers: CLAUDE_TIER_DEFAULTS,
          tierHints: API_TIER_HINTS,
          usage: U,
          cacheStore: await cacheStats(),
        }
      : {}),
    routingOn: normalizeRouting(aiSet.routing).enabled,
    // For the model picker on AI buttons (everyone): what each tier runs on here, and the custom
    // configurations.
    aiChoices: (() => {
      const r: any = normalizeRouting(aiSet.routing);
      const api = active || usable[0] || null;
      const tierModel = (t) =>
        mode === 'account'
          ? aiSet.localEngine === 'copilot'
            ? r.copilot[t] || aiSet.copilotModel || 'Copilot default'
            : r.claude[t] || CLAUDE_TIER_DEFAULTS[t]
          : api
            ? r.api[api.entryId]?.[t] || api.model
            : '';
      return {
        tiers: Object.fromEntries(TIERS.map((t) => [t, tierModel(t)])),
        configs: normalizeConfigs(aiSet.configs)
          .filter((c) => c.enabled)
          .map((c) => ({
            id: c.id,
            name: c.name,
            engine: c.engine,
            model: c.model,
            reasoning: c.reasoning,
          })),
      };
    })(),
    providers: Object.entries<any>(PROVIDERS).map(([id, p]: any) => ({
      id,
      label: p.label,
      keys: p.keys,
      base: p.base || null,
      model: p.model || null,
      site: p.site || null,
      kind: p.kind || 'openai',
      keyLabel: p.keyLabel || null,
    })),
  };
}
// ---------------------------------------------------------------- Claude Code (local, personal
// account)
const G = globalThis;
G.__tfClaude ??= { status: null, statusAt: 0, pending: null };
export const C = G.__tfClaude;
export function cliEnv() {
  const env: any = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  // Keep the CLI on your signed-in Claude account even when an API key is in the environment.
  if (!process.env.TICKETFORGE_CLI_USE_API_KEY) delete env.ANTHROPIC_API_KEY;
  return env;
}
function runCli(args, { timeout = 20000 }: any = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      /*turbopackIgnore: true*/ CLI_BIN,
      args,
      { cwd: WORKDIR, env: cliEnv(), timeout, maxBuffer: 1 << 20 },
      (err, stdout, stderr) =>
        resolve({
          code: err ? (err.code ?? 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        }),
    );
    child.stdin.end();
  });
}
/**
 * GitHub Copilot's limits as TicketForge can see them on this computer (the Copilot CLI doesn't
 * report your plan's premium-request quota): { connected, reason?, rows: [{ key, name, value,
 * reached }] }. "Connected" = TicketForge runs on this computer, the CLI is installed and it isn't
 * signed out. Not connected → no rows.
 */
export async function copilotLimits() {
  if (aiMode() !== 'account')
    return {
      connected: false,
      rows: [],
      reason: 'GitHub Copilot only runs when TicketForge is opened on your own computer.',
    };
  const info = await copilotInfo();
  if (!info.available)
    return {
      connected: false,
      rows: [],
      reason: 'The GitHub Copilot CLI isn’t installed on this computer.',
    };
  const cool = health('copilot');
  if (cool?.kind === 'auth')
    return {
      connected: false,
      rows: [],
      reason: 'GitHub Copilot isn’t signed in on this computer.',
    };
  const s = await getAiSettings().catch(() => ({}));
  const hit = Boolean(cool && ['rate', 'credits'].includes(cool.kind));
  const back = new Date(cool?.until || 0).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
  return {
    connected: true,
    rows: [
      {
        key: 'usage',
        name: 'Usage limit',
        value: hit ? `Reached, back at ${back}` : 'Not reached',
        reached: hit,
      },
      { key: 'model', name: 'Model', value: s.copilotModel || 'Copilot’s default', reached: false },
      {
        key: 'role',
        name: 'Used as',
        value:
          s.localEngine === 'copilot'
            ? 'Main local AI'
            : s.copilotBackup
              ? 'Backup for your Claude account'
              : 'Not used',
        reached: false,
      },
      { key: 'cli', name: 'Copilot CLI', value: `Version ${info.version}`, reached: false },
    ],
  };
}
/**
 * Whether Claude Code on this computer is signed in. Fresh for a minute; after that the last answer
 * is returned at once and checked again in the background, so the status bar never waits on (or
 * flickers with) the CLI.
 */
export async function accountStatus({ fresh = false }: any = {}) {
  const age = Date.now() - C.statusAt;
  if (!fresh && C.status && age < 60000) return C.status;
  if (!fresh && C.status && age < 15 * 60000) {
    checkAccount().catch(() => {});
    return C.status;
  }
  return checkAccount();
}
async function readAccount() {
  const r: any = await runCli(['auth', 'status', '--json'], { timeout: 15000 });
  try {
    const j = JSON.parse(r.stdout);
    return {
      loggedIn: Boolean(j.loggedIn),
      authMethod: j.authMethod || null,
      email: j.email || null,
      orgName: j.orgName || null,
      subscriptionType: j.subscriptionType || null,
    };
  } catch {
    // No JSON: an older Claude Code without `claude auth` (unknown, so don't block it), or a failed
    // or timed-out check (null: keep what we knew).
    return r.code === 0 ? { loggedIn: null } : null;
  }
}
/** One check at a time: requests that arrive meanwhile share it. */
function checkAccount() {
  C.pending ??= (async () => {
    try {
      await cliInfo();
      let st = await readAccount();
      // Signed in a moment ago and now not? Ask once more before showing it (token refreshes can
      // blip).
      if (st?.loggedIn === false && C.status?.loggedIn === true) {
        await new Promise((r) => setTimeout(r, 1500));
        st = await readAccount();
      }
      if (st) C.status = st;
      else C.status ??= { loggedIn: null };
      C.statusAt = Date.now();
      return C.status;
    } finally {
      C.pending = null;
    }
  })();
  return C.pending;
}
