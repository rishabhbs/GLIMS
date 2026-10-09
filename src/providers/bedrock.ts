/**
 * BedrockProvider — concrete ModelProvider for Amazon Bedrock (Anthropic Claude),
 * built on the Vercel AI SDK (@ai-sdk/amazon-bedrock). The AI SDK is used ONLY
 * inside this file; the rest of the app depends on the ModelProvider interface.
 *
 * Auth: a Bedrock API key (bearer token) via AWS_BEARER_TOKEN_BEDROCK. Chat and
 * structured extraction run on a Claude inference profile (e.g.
 * au.anthropic.claude-haiku-4-5-...). The model id must be a region-appropriate
 * INFERENCE PROFILE id, not a bare foundation-model id (on-demand throughput
 * requires a profile on Bedrock).
 *
 * Embeddings: Amazon Titan Text Embeddings v2, with output dimensionality pinned
 * to BRAIN_EMBEDDING_DIMENSIONS (1024 by default — Titan v2's native max). Fully
 * on AWS; no third-party embedding dependency.
 */
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { embedMany, generateText } from "ai";
import type { ChatMessage, ChatOptions, ChatResult, EmbedResult, ModelProvider, StructuredSchema } from "./types";

export interface BedrockProviderConfig {
  chatModel: string;
  region: string;
  apiKey: string;
  /** Titan embedding model id + output dimensionality (schema-committed). */
  embeddingModel: string;
  embeddingDimensions: number;
}

export class BedrockProvider implements ModelProvider {
  private readonly bedrock: ReturnType<typeof createAmazonBedrock>;

  constructor(private readonly cfg: BedrockProviderConfig) {
    if (!cfg.apiKey) {
      throw new Error(
        "[BedrockProvider] Missing AWS_BEARER_TOKEN_BEDROCK. Set the Bedrock API key in .env.local to use MODEL_PROVIDER=bedrock.",
      );
    }
    // This provider version (AI SDK v4 line) authenticates via the AWS SDK, not
    // an apiKey option. Bedrock API keys are bearer tokens: supply the token as a
    // smithy TokenIdentity through bedrockOptions, and also export the standard
    // env var the AWS SDK's bearer auth looks for.
    process.env.AWS_BEARER_TOKEN_BEDROCK = cfg.apiKey;
    this.bedrock = createAmazonBedrock({
      bedrockOptions: {
        region: cfg.region,
        token: { token: cfg.apiKey },
        authSchemePreference: ["httpBearerAuth"],
      },
    });
  }

  async embed(texts: string[]): Promise<EmbedResult> {
    // Titan v2 supports 1024 | 512 | 256; snap config to the nearest allowed value.
    const allowed = [256, 512, 1024] as const;
    const dims = (allowed.find((d) => d === this.cfg.embeddingDimensions) ?? 1024) as 256 | 512 | 1024;
    const { embeddings } = await embedMany({
      model: this.bedrock.embedding(this.cfg.embeddingModel, {
        dimensions: dims,
        normalize: true,
      }),
      values: texts,
    });
    return { vectors: embeddings, model: this.cfg.embeddingModel };
  }

  async chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult> {
    const { text } = await withRetry(() =>
      generateText({
        model: this.bedrock(this.cfg.chatModel),
        messages,
        temperature: opts?.temperature ?? 0.2,
        maxTokens: opts?.maxTokens ?? 1024,
      }),
    );
    return { text, model: this.cfg.chatModel };
  }

  async structuredExtract<T>(input: string, schema: StructuredSchema<T>, opts?: ChatOptions): Promise<T> {
    const { text } = await withRetry(() =>
      generateText({
        model: this.bedrock(this.cfg.chatModel),
        temperature: opts?.temperature ?? 0,
        // Extraction can emit many items; give it ample room so the JSON isn't
        // truncated mid-object (which would make JSON.parse fail).
        maxTokens: opts?.maxTokens ?? 8192,
        messages: [
          {
            role: "system",
            content:
              `${schema.instruction}\n\nRespond with ONLY valid JSON matching this JSON Schema:\n` +
              `${JSON.stringify(schema.jsonSchema)}\nNo prose, no markdown, no code fences.`,
          },
          { role: "user", content: input },
        ],
      }),
    );
    return schema.parse(parseJsonLoose(text));
  }
}

/**
 * Parse JSON from a model response, tolerating code fences, surrounding prose,
 * and (as a last resort) truncation. The extractor sometimes gets cut off; if a
 * clean parse fails we try to recover the largest valid JSON prefix.
 */
function parseJsonLoose(text: string): unknown {
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  // Narrow to the outermost object if there's leading/trailing prose.
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first > 0 || (last !== -1 && last < t.length - 1)) {
    if (first >= 0 && last > first) t = t.slice(first, last + 1);
  }
  try {
    return JSON.parse(t);
  } catch {
    return JSON.parse(repairTruncatedJson(t));
  }
}

/**
 * Best-effort repair of JSON truncated mid-structure: drop any trailing partial
 * token, then close open strings/brackets so a valid object parses. Loses the
 * incomplete trailing item but preserves everything complete before it.
 */
function repairTruncatedJson(input: string): string {
  let s = input;
  // If we're inside a string (odd count of unescaped quotes), close it.
  const quotes = (s.match(/(?<!\\)"/g) ?? []).length;
  if (quotes % 2 !== 0) s += '"';
  // Trim a dangling comma or partial key/value.
  s = s.replace(/,\s*$/, "");
  // Close any unbalanced [ and { in the right order.
  const stack: string[] = [];
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && s[i - 1] !== "\\") inStr = !inStr;
    if (inStr) continue;
    if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") stack.pop();
  }
  while (stack.length) {
    const open = stack.pop();
    s += open === "{" ? "}" : "]";
  }
  return s;
}

/** Retry transient Bedrock throttling (429 / ThrottlingException / 5xx). */
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
  if (status === 429 || status === 500 || status === 503) return true;
  const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
  return msg.includes("throttl") || msg.includes("too many requests") || msg.includes("service unavailable");
}
