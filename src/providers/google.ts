/**
 * GoogleProvider — concrete ModelProvider for Google Gemini, built on the
 * Vercel AI SDK (@ai-sdk/google). The AI SDK is used ONLY inside this file;
 * the rest of the app depends on the ModelProvider interface.
 *
 * Notes:
 * - Chat/extraction use Gemini models (e.g. gemini-1.5-flash).
 * - Embeddings use Gemini embedding models (e.g. text-embedding-004). Gemini
 *   embedding models support a configurable output dimensionality, so we pin it
 *   to our schema commitment (BRAIN_EMBEDDING_DIMENSIONS) via outputDimensionality
 *   so vectors always match the vector(N) column.
 */
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { embedMany, generateText } from "ai";
import type { ChatMessage, ChatOptions, ChatResult, EmbedResult, ModelProvider, StructuredSchema } from "./types";

export interface GoogleProviderConfig {
  chatModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
  apiKey: string;
}

export class GoogleProvider implements ModelProvider {
  private readonly google: ReturnType<typeof createGoogleGenerativeAI>;

  constructor(private readonly cfg: GoogleProviderConfig) {
    if (!cfg.apiKey) {
      throw new Error(
        "[GoogleProvider] Missing GOOGLE_GENERATIVE_AI_API_KEY. Set it in .env.local to use MODEL_PROVIDER=google.",
      );
    }
    this.google = createGoogleGenerativeAI({ apiKey: cfg.apiKey });
  }

  async embed(texts: string[]): Promise<EmbedResult> {
    const { embeddings } = await embedMany({
      model: this.google.textEmbeddingModel(this.cfg.embeddingModel, {
        outputDimensionality: this.cfg.embeddingDimensions,
      }),
      values: texts,
    });
    return { vectors: embeddings, model: this.cfg.embeddingModel };
  }

  async chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult> {
    const { text } = await withRetry(() =>
      generateText({
        model: this.google(this.cfg.chatModel),
        messages,
        temperature: opts?.temperature ?? 0.2,
        maxTokens: opts?.maxTokens,
      }),
    );
    return { text, model: this.cfg.chatModel };
  }

  async structuredExtract<T>(input: string, schema: StructuredSchema<T>, opts?: ChatOptions): Promise<T> {
    const { text } = await withRetry(() =>
      generateText({
      model: this.google(this.cfg.chatModel),
      temperature: opts?.temperature ?? 0,
      maxTokens: opts?.maxTokens,
      messages: [
        {
          role: "system",
          content:
            `${schema.instruction}\n\n` +
            `Respond with ONLY valid JSON matching this JSON Schema:\n` +
            `${JSON.stringify(schema.jsonSchema)}\n` +
            `Do not include any prose, markdown, or code fences.`,
        },
        { role: "user", content: input },
      ],
      }),
    );
    return schema.parse(parseJsonLoose(text));
  }
}

/** Tolerate models that wrap JSON in code fences. */
function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  return JSON.parse(trimmed);
}

/**
 * Retry transient Gemini failures (503 UNAVAILABLE / 429 rate limit). Gemini's
 * free/standard tiers return 503 "high demand" in bursts; the AI SDK's built-in
 * retries are short, so we add our own bounded exponential backoff on top.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isTransient(e) || i === attempts - 1) throw e;
      const delayMs = Math.min(1000 * 2 ** i, 8000) + Math.floor(Math.random() * 400);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

function isTransient(e: unknown): boolean {
  const status = (e as { statusCode?: number; status?: number })?.statusCode ??
    (e as { status?: number })?.status;
  if (status === 503 || status === 429 || status === 500) return true;
  const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
  return msg.includes("unavailable") || msg.includes("high demand") || msg.includes("overloaded") || msg.includes("rate limit");
}
