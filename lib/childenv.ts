// The environment for processes TicketForge starts inside the repository of the app a project builds (code-job agents,
// the repository profile agent, the npm test setup step). They must never see TicketForge's own database, encryption
// key, mail password or AI keys: an agent running `npm run migrate` would otherwise migrate TicketForge itself.
// With a Test database, DATABASE_URL (and TEST_DATABASE_URL) point to it instead.

const OWN =
  /^(DATABASE_URL|SUPABASE_DB_URL|TICKETFORGE_.*|SMTP_.*|PG[A-Z_]*|AI_(API_KEY|PROVIDER|MODEL|BASE_URL|MODE)|(OPENAI|GEMINI|OPENROUTER|GROQ|DEEPSEEK|MISTRAL|XAI|TOGETHER)_API_KEY)$/;

export function appEnv(base: Record<string, any> = process.env, testDatabaseUrl = ''): NodeJS.ProcessEnv {
  const env: Record<string, any> = {};
  for (const [k, v] of Object.entries(base)) if (!OWN.test(k)) env[k] = v;
  if (testDatabaseUrl) {
    env.DATABASE_URL = testDatabaseUrl;
    env.TEST_DATABASE_URL = testDatabaseUrl;
  }
  return env as NodeJS.ProcessEnv;
}
