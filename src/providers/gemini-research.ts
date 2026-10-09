/**
 * GeminiWebResearchProvider — live web research via Gemini's native Google
 * Search grounding (and URL context when supported). Reuses the existing
 * @ai-sdk/google dependency; no third-party search API required.
 *
 * The model searches the live web, synthesizes an answer, and returns real
 * grounding metadata. We capture ACTUAL source URLs/titles and grounded
 * excerpts from providerMetadata.google.groundingMetadata — we never fabricate
 * citations or excerpts. If grounding returns no sources, we report none.
 *
 * GOOGLE_GENERATIVE_AI_API_KEY is server-side only. The hosted app calls Gemini
 * directly; this does not depend on any local Kiro session or CLI.
 */
import { createGoogleGenerativeAI, type GoogleGenerativeAIProviderMetadata } from "@ai-sdk/google";
import { generateText } from "ai";
import type {
  ResearchSource,
  WebResearchOptions,
  WebResearchOutput,
  WebResearchProvider,
} from "./web-research";

export interface GeminiResearchConfig {
  apiKey: string;
  /** Model used for research (must support search grounding), e.g. gemini-1.5-flash. */
  model: string;
}

export class GeminiWebResearchProvider implements WebResearchProvider {
  readonly name = "gemini";
  readonly isMock = false;
  private readonly google: ReturnType<typeof createGoogleGenerativeAI>;

  constructor(private readonly cfg: GeminiResearchConfig) {
    if (!cfg.apiKey) {
      throw new Error(
        "[GeminiWebResearchProvider] Missing GOOGLE_GENERATIVE_AI_API_KEY. " +
          "Set it to use WEB_RESEARCH_PROVIDER=gemini.",
      );
    }
    this.google = createGoogleGenerativeAI({ apiKey: cfg.apiKey });
  }

  async research(query: string, opts: WebResearchOptions = {}): Promise<WebResearchOutput> {
    const domainHint = opts.includeDomains?.length
      ? ` Prefer official/primary sources from: ${opts.includeDomains.join(", ")}.`
      : "";
    const prompt =
      `Research this question using Google Search and answer with specifics.${domainHint}\n` +
      `Cite concrete sources. If the web does not clearly establish an answer, say so.\n\n` +
      `Question: ${query}`;

    const { text, sources, providerMetadata } = await withRetry(() =>
      generateText({
        // useSearchGrounding enables native Google Search grounding (AI SDK v4).
        model: this.google(this.cfg.model, { useSearchGrounding: true }),
        prompt,
        temperature: 0.2,
      }),
    );

    const meta = providerMetadata?.google as GoogleGenerativeAIProviderMetadata | undefined;
    const grounding = meta?.groundingMetadata ?? null;

    // Build an index -> excerpt map from groundingSupports (real segments).
    const chunkExcerpts = new Map<number, string[]>();
    for (const support of grounding?.groundingSupports ?? []) {
      const segText = support.segment?.text ?? support.segment_text ?? null;
      if (!segText) continue;
      for (const idx of support.groundingChunkIndices ?? []) {
        const arr = chunkExcerpts.get(idx) ?? [];
        arr.push(segText);
        chunkExcerpts.set(idx, arr);
      }
    }

    // Primary source list: grounding chunks (real url + title).
    const chunks = grounding?.groundingChunks ?? [];
    const bySource = new Map<string, ResearchSource>();
    chunks.forEach((chunk, i) => {
      const web = chunk.web ?? chunk.retrievedContext ?? null;
      if (!web?.uri) return;
      const excerpts = chunkExcerpts.get(i) ?? [];
      const existing = bySource.get(web.uri);
      const excerpt = excerpts.length ? excerpts.join(" … ").slice(0, 800) : null;
      if (existing) {
        if (!existing.excerpt && excerpt) existing.excerpt = excerpt;
      } else {
        bySource.set(web.uri, { url: web.uri, title: web.title ?? null, excerpt });
      }
    });

    // Fall back to the AI SDK `sources` array (also real) for any url not in chunks.
    for (const s of sources ?? []) {
      if (s.sourceType !== "url") continue;
      if (!bySource.has(s.url)) {
        bySource.set(s.url, { url: s.url, title: s.title ?? null, excerpt: null });
      }
    }

    return {
      answer: text,
      queries: grounding?.webSearchQueries ?? [],
      sources: [...bySource.values()],
      isMock: false,
    };
  }
}

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
  const status = (e as { statusCode?: number; status?: number })?.statusCode ?? (e as { status?: number })?.status;
  if (status === 503 || status === 429 || status === 500) return true;
  const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
  return msg.includes("unavailable") || msg.includes("high demand") || msg.includes("overloaded") || msg.includes("rate limit");
}
