/**
 * MockProvider — deterministic, offline provider for tests and local dev
 * without API keys. Embeddings are a cheap deterministic hash projection so
 * similar strings get somewhat-similar vectors; chat/extract are stubs.
 */
import type { ChatMessage, ChatOptions, ChatResult, EmbedResult, ModelProvider, StructuredSchema } from "./types";

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic pseudo-embedding: token-bucketed bag-of-words into N dims. */
function fakeEmbedding(text: string, dims: number): number[] {
  const vec = new Array<number>(dims).fill(0);
  const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
  for (const tok of tokens) {
    const idx = hashString(tok) % dims;
    vec[idx] += 1;
  }
  // L2 normalize so cosine similarity behaves.
  const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1;
  return vec.map((v) => v / norm);
}

export class MockProvider implements ModelProvider {
  constructor(private readonly dims: number = 1536) {}

  async embed(texts: string[]): Promise<EmbedResult> {
    return { vectors: texts.map((t) => fakeEmbedding(t, this.dims)), model: "mock-embedding" };
  }

  async chat(messages: ChatMessage[], _opts?: ChatOptions): Promise<ChatResult> {
    const last = messages[messages.length - 1]?.content ?? "";
    return { text: `[mock answer] ${last.slice(0, 200)}`, model: "mock-chat" };
  }

  async structuredExtract<T>(input: string, schema: StructuredSchema<T>, _opts?: ChatOptions): Promise<T> {
    // Mock returns an empty-but-valid shape when possible; tests override as needed.
    return schema.parse(JSON.parse("{}"));
  }
}
