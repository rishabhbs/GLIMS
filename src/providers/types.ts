/**
 * ModelProvider — the vendor-agnostic AI interface.
 *
 * MANDATORY (see .kiro/steering/tech.md): the rest of the system depends ONLY
 * on this interface, never on a vendor SDK directly. Concrete implementations
 * live in this folder (openai, anthropic, mock) and are selected by env.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResult {
  text: string;
  model: string;
}

export interface EmbedResult {
  vectors: number[][];
  model: string;
}

export interface ModelProvider {
  /** Embed one or more texts. Returns vectors + the model id used. */
  embed(texts: string[]): Promise<EmbedResult>;

  /** Freeform chat completion. */
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult>;

  /**
   * Structured extraction: given input text and a Zod-like schema, return a
   * typed object. Implemented via the provider's structured-output / JSON mode.
   */
  structuredExtract<T>(
    input: string,
    schema: StructuredSchema<T>,
    opts?: ChatOptions,
  ): Promise<T>;
}

/**
 * A minimal schema wrapper so callers don't couple to a specific validation lib
 * at the interface boundary. We back it with Zod inside the brain layer.
 */
export interface StructuredSchema<T> {
  name: string;
  /** JSON Schema describing the expected output. */
  jsonSchema: Record<string, unknown>;
  /** Parse/validate raw JSON into T (throws on invalid). */
  parse(raw: unknown): T;
  /** Instruction appended to the system prompt describing the task. */
  instruction: string;
}
