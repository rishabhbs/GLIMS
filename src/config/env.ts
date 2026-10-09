/**
 * Centralized, validated configuration for LIMS Brain.
 *
 * Rules (see .kiro/steering/tech.md):
 * - Secrets live only in env. Never commit them.
 * - The embedding dimension is a SCHEMA commitment and is pinned here; it must
 *   match the vector(N) column in the DB. Changing it requires a re-embedding migration.
 * - Fail fast: required server env is validated the first time it's accessed on the server.
 */

export type ProviderName = "openai" | "anthropic" | "google" | "bedrock" | "mock";
export type WebResearchProviderName = "gemini" | "mock";

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(
      `[config] Missing required environment variable: ${name}. ` +
        `Set it in .env.local (see .env.example).`,
    );
  }
  return value;
}

function optional(value: string | undefined, fallback: string): string {
  return value && value.trim() !== "" ? value : fallback;
}

/** Public (browser-safe) config. Only NEXT_PUBLIC_* values. */
export const publicConfig = {
  supabaseUrl: optional(process.env.NEXT_PUBLIC_SUPABASE_URL, ""),
  supabaseAnonKey: optional(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, ""),
};

/**
 * Server-only config. Access this only from server code (route handlers,
 * server actions, BrainService). Throws if required values are missing.
 */
export function getServerConfig() {
  const providerName = optional(process.env.MODEL_PROVIDER, "mock") as ProviderName;

  const embeddingDimensions = Number.parseInt(
    optional(process.env.BRAIN_EMBEDDING_DIMENSIONS, "1536"),
    10,
  );
  if (!Number.isFinite(embeddingDimensions) || embeddingDimensions <= 0) {
    throw new Error(
      `[config] BRAIN_EMBEDDING_DIMENSIONS must be a positive integer; got "${process.env.BRAIN_EMBEDDING_DIMENSIONS}".`,
    );
  }

  return {
    supabase: {
      url: required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
      anonKey: required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY),
    },
    model: {
      provider: providerName,
      chatModel: optional(process.env.BRAIN_CHAT_MODEL, "gpt-4o-mini"),
      embeddingModel: optional(process.env.BRAIN_EMBEDDING_MODEL, "text-embedding-3-small"),
      embeddingDimensions,
      openaiApiKey: process.env.OPENAI_API_KEY,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      googleApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      bedrockApiKey: process.env.AWS_BEARER_TOKEN_BEDROCK,
      bedrockRegion: optional(process.env.AWS_REGION, "us-east-1"),
    },
    research: {
      // 'gemini' uses Gemini native Google Search grounding; 'mock' is offline/tests.
      provider: optional(process.env.WEB_RESEARCH_PROVIDER, "mock") as WebResearchProviderName,
      googleApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      geminiResearchModel: optional(process.env.BRAIN_RESEARCH_MODEL, "gemini-flash-latest"),
    },
    defaultWorkspaceId: optional(
      process.env.BRAIN_DEFAULT_WORKSPACE_ID,
      "00000000-0000-0000-0000-000000000001",
    ),
    ingestWorkerSecret: optional(process.env.INGEST_WORKER_SECRET, ""),
  };
}

export type ServerConfig = ReturnType<typeof getServerConfig>;
