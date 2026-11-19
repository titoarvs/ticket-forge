// AI for TicketForge. Two modes, picked per request:
//  - "account": on your own computer (opened at localhost), the Claude Code CLI (`claude -p`) with
//    the personal Claude account you're signed into there. No API key needed.
//  - "api": anywhere else (Vercel, a server, a domain), an AI API you configure with environment
//    variables:
//    Anthropic, or any OpenAI-compatible API (OpenAI, Google Gemini, OpenRouter, Groq, DeepSeek,
//    Mistral, xAI, Together, Ollama, or your own endpoint). Set up by an administrator in
//    Administration → AI, or with environment variables (see .env.example). Several APIs can be set
//    up in priority order: when one is rate limited, out of credits or failing, TicketForge
//    switches to the next and retries the first one later.
//    Locally, when your Claude account hits its usage limit, it can switch to those APIs too.
// AI_MODE=account|api overrides the automatic choice.

export {
  DEFAULT_API_MODEL,
  DEFAULT_CLI_MODEL,
  cliInfo,
  isLocalHost,
  aiMode,
  PROVIDERS,
  SUBSCRIPTION_TOKEN_NOTE,
  isSubscriptionToken,
  apiChain,
  apiConfig,
  clearCooldown,
  askAI,
  budgetState,
  aiUsage,
  agentModel,
  noteAgentUsage,
  clearAiUsage,
  askViaSubscription,
  askClaude,
} from './claude/ask-ai';
export { providerStatus, copilotLimits, accountStatus } from './claude/provider-status';
export {
  listModels,
  testConnection,
  extractJson,
  askJson,
  claudeCodeCommand,
} from './claude/test-connection';
