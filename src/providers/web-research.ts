/**
 * WebResearchProvider — live web research via a model's native search grounding.
 *
 * Reshaped for Gemini's native Google Search grounding: the model performs
 * search + synthesis + citation in ONE call and returns real grounding metadata
 * (source URLs/titles) — so a single `research()` method is the right shape
 * rather than a Tavily-style search()+extract() split.
 *
 * The interface is kept (not collapsed into ModelProvider) only because it
 * provides useful flexibility: a deterministic Mock impl for tests vs. the real
 * Gemini impl, selected by env. Callers depend only on this interface.
 */

export interface WebResearchOptions {
  /** Prefer these domains for official/primary sources (standards/regulatory). */
  includeDomains?: string[];
  /** Restrict to results within the last N days (recency), when supported. */
  days?: number;
}

/** A real source returned by the model's grounding metadata — never fabricated. */
export interface ResearchSource {
  url: string;
  title: string | null;
  /** Verbatim grounded excerpt(s) from the model's groundingSupports, if any. */
  excerpt: string | null;
}

export interface WebResearchOutput {
  /** The model's synthesized, grounded answer text. */
  answer: string;
  /** Actual search queries the model ran (grounding metadata), if reported. */
  queries: string[];
  /** Real grounded sources (url/title/excerpt) from grounding metadata. */
  sources: ResearchSource[];
  /** True when the provider is the deterministic mock (clearly not real web). */
  isMock: boolean;
}

export interface WebResearchProvider {
  readonly name: string;
  /** True for the mock provider so callers/UI can distinguish test data. */
  readonly isMock: boolean;
  research(query: string, opts?: WebResearchOptions): Promise<WebResearchOutput>;
}
