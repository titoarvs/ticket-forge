// Claude providers.
//  - "cli": shells out to the Claude Code CLI (`claude -p`), which uses the Claude
//    account you are logged into on this machine. No API key needed.
//  - "api": uses the Anthropic SDK with ANTHROPIC_API_KEY.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

let CLI_BIN = process.env.CLAUDE_BIN || 'claude';
const WORKDIR = path.join(os.tmpdir(), 'ticketforge-claude');
fs.mkdirSync(WORKDIR, { recursive: true });

export const DEFAULT_API_MODEL = 'claude-opus-5-5';
export const DEFAULT_CLI_MODEL = 'opus';

// Candidate Claude Code executables: $CLAUDE_BIN, `claude` on PATH, native installs, and the copy
// bundled with the Claude desktop app. The newest version wins, because old versions can't use
// current models.
function candidateBins() {
  if (process.env.CLAUDE_BIN) return [process.env.CLAUDE_BIN];
  const home = os.homedir();
  const out = ['claude'];
  const globDir = (dir, sub = []) => {
    try {
      return fs.readdirSync(dir).flatMap((v) => {
        const base = path.join(dir, v);
        if (!sub.length) return [base];
        return globDir(base, sub.slice(1)).map((x) => x);
      });
    } catch { return []; }
  };
  out.push(...globDir(path.join(home, '.local', 'share', 'claude', 'versions')));
  for (const d of globDir(path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code'), ['*'])) {
    out.push(path.join(d, 'claude.app', 'Contents', 'MacOS', 'claude'));
  }
  out.push(path.join(home, '.claude', 'local', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude');
  return [...new Set(out)];
}
const versionOf = (bin) => new Promise((resolve) => {
  execFile(/*turbopackIgnore: true*/ bin, ['--version'], { timeout: 15000 }, (err, stdout) => {
    const m = !err && String(stdout).match(/(\d+)\.(\d+)\.(\d+)/);
    resolve(m ? { bin, version: m[0], n: [Number(m[1]), Number(m[2]), Number(m[3])] } : null);
  });
});
const newer = (a, b) => { for (let i = 0; i < 3; i++) if (a.n[i] !== b.n[i]) return a.n[i] > b.n[i]; return false; };

let cliInfoPromise = null;
export function cliInfo() {
  cliInfoPromise ??= (async () => {
    const found = (await Promise.all(candidateBins().map(versionOf))).filter(Boolean);
    if (!found.length) return { available: false };
    const best = found.reduce((a, b) => (newer(b, a) ? b : a));
    CLI_BIN = best.bin;
    const outdated = best.n[0] < 2 || (best.n[0] === 2 && best.n[1] < 1);
    return { available: true, version: `${best.version} (Claude Code)`, path: best.bin, outdated };
  })();
  return cliInfoPromise;
}

export async function providerStatus() {
  const cli = await cliInfo();
  const api = Boolean(process.env.ANTHROPIC_API_KEY);
  const preferred = process.env.TICKETFORGE_PROVIDER || (cli.available ? 'cli' : api ? 'api' : 'none');
  return { cli, api, defaultProvider: preferred, defaultModels: { cli: DEFAULT_CLI_MODEL, api: DEFAULT_API_MODEL } };
}

/**
 * Ask Claude once. Returns the full text reply.
 * opts: { system, prompt, provider, model, onText(chunkLength,totalLength), signal }
 */
export async function askClaude(opts) {
  const status = await providerStatus();
  const provider = opts.provider || status.defaultProvider;
  if (provider === 'cli') {
    if (!status.cli.available) throw new Error('Claude Code CLI not found. Install it and run `claude` once to log in, or set ANTHROPIC_API_KEY.');
    return askViaCli({ ...opts, model: opts.model || DEFAULT_CLI_MODEL });
  }
  if (provider === 'api') {
    if (!status.api) throw new Error('ANTHROPIC_API_KEY is not set.');
    return askViaApi({ ...opts, model: opts.model || DEFAULT_API_MODEL });
  }
  throw new Error('No Claude provider available. Log in with the Claude Code CLI (`claude`) or set ANTHROPIC_API_KEY.');
}

function askViaCli({ system, prompt, model, onText, signal }) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--model', model,
      '--tools', '',
      '--strict-mcp-config',
      '--system-prompt', system,
    ];
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    // Keep the CLI on the logged-in Claude account unless the user explicitly chose API mode.
    if (!process.env.TICKETFORGE_CLI_USE_API_KEY) delete env.ANTHROPIC_API_KEY;
    const child = spawn(/*turbopackIgnore: true*/ CLI_BIN, args, { cwd: WORKDIR, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    let streamed = '';
    let finalResult = null;
    let errorText = '';
    let stderr = '';

    const onAbort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', onAbort);

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let evt;
        try { evt = JSON.parse(line); } catch { continue; }
        if (evt.type === 'stream_event' && evt.event?.type === 'content_block_delta' && evt.event.delta?.type === 'text_delta') {
          streamed += evt.event.delta.text;
          onText?.(evt.event.delta.text.length, streamed.length);
        } else if (evt.type === 'result') {
          if (evt.is_error || evt.subtype !== 'success') errorText = evt.result || evt.subtype || 'Claude CLI returned an error';
          else finalResult = evt.result;
        }
      }
    });
    child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(new Error('Cancelled'));
      if (errorText) {
        const hint = /does not support this model|not_found_error|model:/i.test(errorText)
          ? ' Your Claude Code version may be too old for this model: run `claude update`, or pick another model in the connection settings.' : '';
        return reject(new Error(errorText + hint));
      }
      const text = finalResult ?? streamed;
      if (!text) return reject(new Error(`Claude CLI exited with code ${code}. ${stderr.slice(-800)}`.trim()));
      resolve(text);
    });
    child.stdin.end(prompt);
  });
}

let apiClient = null;
async function askViaApi({ system, prompt, model, onText, signal }) {
  apiClient ??= new Anthropic();
  const params = {
    model,
    max_tokens: 64000,
    system,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    messages: [{ role: 'user', content: prompt }],
  };
  // Server-side refusal fallback is supported on the current Opus/Sonnet models.
  const useFallback = /^claude-(opus-5|sonnet-5-5|fable-5-1)/.test(model);
  const stream = useFallback
    ? apiClient.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal })
    : apiClient.messages.stream(params, { signal });
  let total = 0;
  stream.on('text', (t) => { total += t.length; onText?.(t.length, total); });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') {
    throw new Error(`Claude declined this request${msg.stop_details?.category ? ` (${msg.stop_details.category})` : ''}.`);
  }
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (msg.stop_reason === 'max_tokens') throw new Error('Response hit the output limit. Try a smaller document or fewer tickets per run.');
  return text;
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

/** Ask for JSON; if parsing fails, ask Claude once to repair its own output. */
export async function askJson(opts) {
  const text = await askClaude(opts);
  try {
    return extractJson(text);
  } catch (err) {
    const repaired = await askClaude({
      ...opts,
      onText: undefined,
      system: 'You repair malformed JSON. Output only the corrected JSON, nothing else.',
      prompt: `This JSON failed to parse (${err.message}). Fix it and return valid JSON only, preserving all content:\n\n${text}`,
    });
    return extractJson(repaired);
  }
}
