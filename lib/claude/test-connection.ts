import { getAiSettings } from '../settings';
import { maxOutFor, AI_TASKS, normalizeRouting, pickFor } from '../aitasks';
import {
  retryAfterMs,
  effortOf,
  targetConfig,
  notReady,
  PROVIDERS,
  anthropicClient,
  aiMode,
  callApi,
  clearCooldown,
  nameOf,
  askAI,
  H,
  askClaude,
  cliInfo,
  CLI_BIN,
} from './ask-ai';
import { apiSetupMessage, accountStatus, cliEnv } from './provider-status';

function openAIHeaders(cfg) {
  return {
    'Content-Type': 'application/json',
    ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}),
    ...(cfg.id === 'openrouter' ? { 'X-Title': 'TicketForge' } : {}),
  };
}
async function apiError(res, cfg) {
  const body = await res.text().catch(() => '');
  let msg = body;
  try {
    const j = JSON.parse(body);
    msg = j.error?.message || j.message || (Array.isArray(j) ? j[0]?.error?.message : '') || body;
  } catch {
    /* not JSON */
  }
  const hint =
    res.status === 401 || res.status === 403
      ? ' Check the API key.'
      : res.status === 404
        ? ' Check the model name and the endpoint URL.'
        : res.status === 429
          ? ' Rate limit or quota reached.'
          : '';
  const text = String(msg || res.statusText)
    .trim()
    .slice(0, 400)
    .replace(/[.\s]+$/, '');
  const who = /API$/.test(cfg.label) ? cfg.label : `${cfg.label} API`;
  return Object.assign(new Error(`${who} error ${res.status}: ${text}.${hint}`), {
    status: 502,
    httpStatus: res.status,
    retryAfterMs: retryAfterMs(res.headers),
  });
}
/** fetch that says which server couldn't be reached instead of just "fetch failed". */
async function reach(cfg, url, init) {
  try {
    return await fetch(url, init);
  } catch (e) {
    if (e.name === 'AbortError' || init?.signal?.aborted) throw e;
    const why = e.cause?.code || e.cause?.message || e.message;
    throw Object.assign(
      new Error(
        `Couldn’t reach ${cfg.baseUrl} (${why}). Check the endpoint URL and that the server is running.`,
      ),
      {
        status: 502,
      },
    );
  }
}
/** Chat completions with streaming, for OpenAI and every OpenAI-compatible API. */
export async function askViaOpenAICompatible(opts) {
  try {
    return await openAIOnce(opts, true);
  } catch (e) {
    // Providers or models without reasoning_effort: ask again without it.
    if (
      e.httpStatus === 400 &&
      /reasoning|unrecognized|unsupported|not supported|unknown (field|parameter)|extra inputs/i.test(
        e.message,
      )
    )
      return openAIOnce(opts, false);
    throw e;
  }
}
async function openAIOnce(
  { system, prompt, model, onText, signal, cfg, reasoning, task, meter }: any,
  tuned,
) {
  const openai = cfg.id === 'openai';
  const res = await reach(cfg, `${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: openAIHeaders(cfg),
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      ...(tuned ? { reasoning_effort: effortOf(reasoning) } : {}),
      // OpenAI itself: report token usage and cap the output (other OpenAI-compatible APIs differ,
      // so left alone).
      ...(openai
        ? {
            stream_options: { include_usage: true },
            max_completion_tokens:
              maxOutFor(task) + (tuned && reasoning && reasoning !== 'fast' ? 16000 : 0),
          }
        : {}),
    }),
  });
  const take = (u) => {
    if (meter && u)
      meter.tokens = {
        input: Math.max(0, (u.prompt_tokens || 0) - (u.prompt_tokens_details?.cached_tokens || 0)),
        output: u.completion_tokens || 0,
        cacheRead: u.prompt_tokens_details?.cached_tokens || 0,
        cacheWrite: 0,
      };
  };
  if (!res.ok) throw await apiError(res, cfg);
  let text = '';
  let finish = null;
  if (!(res.headers.get('content-type') || '').includes('text/event-stream')) {
    const j = await res.json();
    take(j.usage);
    text = j.choices?.[0]?.message?.content || '';
    finish = j.choices?.[0]?.finish_reason || null;
    if (text) onText?.(text.length, text.length, text);
  } else {
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body as any) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let j;
        try {
          j = JSON.parse(data);
        } catch {
          continue;
        }
        if (j.error)
          throw Object.assign(
            new Error(`${cfg.label}: ${j.error.message || JSON.stringify(j.error)}`),
            { status: 502 },
          );
        if (j.usage) take(j.usage);
        const choice = j.choices?.[0];
        const delta = choice?.delta?.content;
        if (typeof delta === 'string' && delta) {
          text += delta;
          onText?.(delta.length, text.length, delta);
        }
        if (choice?.finish_reason) finish = choice.finish_reason;
      }
    }
  }
  if (finish === 'length')
    throw new Error(
      'Response hit the output limit. Try a smaller document or fewer tickets per run.',
    );
  if (finish === 'content_filter') throw new Error(`${cfg.label} declined this request.`);
  if (!text.trim())
    throw Object.assign(
      new Error(`${cfg.label} returned an empty reply. Check that AI_MODEL is a chat model.`),
      { status: 502 },
    );
  return text;
}
/**
 * Model IDs a provider offers: { id } a saved one, { draft } unsaved settings, or the active one.
 */
export async function listModels(target) {
  const cfg = await targetConfig(target);
  if (!cfg?.id || (cfg.error && !cfg.keySet)) throw notReady(apiSetupMessage(cfg));
  if (!cfg.keySet && !PROVIDERS[cfg.id]?.keyOptional) throw notReady('Enter the API key first.');
  if (cfg.kind === 'openai' && !cfg.baseUrl) throw notReady('Enter the endpoint URL first.');
  if (cfg.kind === 'claude-code') return ['opus', 'sonnet', 'haiku'];
  if (cfg.kind === 'anthropic') {
    const out: any[] = [];
    for await (const m of anthropicClient(cfg).models.list({ limit: 100 })) out.push(m.id);
    return out;
  }
  const res = await reach(cfg, `${cfg.baseUrl}/models`, {
    headers: openAIHeaders(cfg),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw await apiError(res, cfg);
  const j = await res.json();
  return (j.data || j.models || [])
    .map((m) => String(m.id || m.name || '').replace(/^models\//, ''))
    .filter(Boolean)
    .sort();
}
/**
 * Sends a tiny prompt. { id } tests one saved provider, { draft } unsaved settings; nothing = the
 * normal path (with switching). A failed API test also lists the models the key can use.
 */
export async function testConnection(target) {
  const one = Boolean(target?.id || target?.draft);
  const mode = one ? 'api' : aiMode();
  const started = Date.now();
  const req = {
    system: 'You are a connection test. Follow the instruction exactly.',
    prompt: 'Reply with exactly: OK',
  };
  let used = null;
  try {
    let reply;
    if (one) {
      const cfg = await targetConfig(target);
      if (!cfg.configured) throw notReady(apiSetupMessage(cfg));
      reply = await callApi(cfg, req);
      if (target.id) clearCooldown(target.id); // it works again
      used = nameOf(cfg);
    } else {
      reply = await askAI({
        ...req,
        model: mode === 'account' ? 'haiku' : undefined,
        onSwitch: () => {},
      });
      used = H.last?.label || null;
    }
    return { ok: true, mode, used, ms: Date.now() - started, reply: reply.trim().slice(0, 80) };
  } catch (e) {
    const out: any = { ok: false, mode, ms: Date.now() - started, error: e.message };
    if (one || mode === 'api') {
      try {
        out.models = (await listModels(one ? target : undefined)).slice(0, 200);
      } catch {
        /* can't list either */
      }
    }
    return out;
  }
}
/** Extract the first JSON object/array from a model reply. */
export function extractJson(text) {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.search(/[[{]/);
  if (start < 0) throw new Error('No JSON found in Claude response');
  const open = t[start];
  const close = open === '{' ? '}' : ']';
  const end = t.lastIndexOf(close);
  return JSON.parse(t.slice(start, end + 1));
}
/** Nothing usable came back: no fields, or only empty ones. */
const looksEmpty = (x) =>
  x == null ||
  (typeof x === 'object' &&
    Object.values<any>(x).every((v) => v == null || v === '' || (Array.isArray(v) && !v.length)));
/**
 * Ask for JSON. Cheap first (Model routing → "Try Standard first"): work routed to High for a task
 * marked escalate runs on Standard, and only when that answer doesn't parse or comes back empty is
 * it asked again on High.
 */
export async function askJson(opts) {
  const task = AI_TASKS.find((t) => t.id === opts.task);
  if (task?.escalate && (!opts.run || opts.run === 'auto')) {
    const routing = normalizeRouting((await getAiSettings().catch(() => ({}))).routing);
    if (routing.escalate && pickFor(routing, opts.task) === 'high') {
      try {
        const r = await askJsonOnce({ ...opts, run: 'standard' });
        if (!looksEmpty(r)) return r;
      } catch (e) {
        if (opts.signal?.aborted || [400, 401, 402, 403].includes(e.status)) throw e;
      }
      return askJsonOnce({ ...opts, run: 'high', escalated: true });
    }
  }
  return askJsonOnce(opts);
}
async function askJsonOnce(opts) {
  const text = await askClaude(opts);
  try {
    return extractJson(text);
  } catch (err) {
    const repaired = await askClaude({
      ...opts,
      onText: undefined,
      brain: undefined,
      system: 'You repair malformed JSON. Output only the corrected JSON, nothing else.',
      prompt: `This JSON failed to parse (${err.message}). Fix it and return valid JSON only, preserving all content:\n\n${text}`,
    });
    return extractJson(repaired);
  }
}
/**
 * The Claude Code command and environment, for running it as a coding agent in a repository (local
 * only).
 */
export async function claudeCodeCommand() {
  const info = await cliInfo();
  if (!info.available)
    throw Object.assign(
      new Error(
        'Claude Code isn’t installed on this computer. Install it (npm install -g @anthropic-ai/claude-code) and run `claude` once to sign in.',
      ),
      { status: 400 },
    );
  if ((await accountStatus()).loggedIn === false)
    throw Object.assign(
      new Error(
        'Claude Code isn’t signed in on this computer. Run `claude` in a terminal and sign in.',
      ),
      {
        status: 400,
      },
    );
  return { bin: CLI_BIN, env: cliEnv(), version: info.version };
}
