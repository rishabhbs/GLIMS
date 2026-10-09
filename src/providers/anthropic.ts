/**
 * AnthropicProvider — second concrete ModelProvider, proving the abstraction
 * holds. Anthropic has no first-party embeddings endpoint, so embedding falls
 * back to OpenAI embeddings if an OpenAI key is present; otherwise it throws a
 * clear error. Chat/extraction use Anthropic via the AI SDK.
 */
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type { ChatMessage, ChatOptions, ChatResult, EmbedResult, ModelProvider, StructuredSchema } from "./types";
import { OpenAIProvider } from "./openai";

export interface AnthropicProviderConfig {
  chatModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
  hasOpenAIKey: boolean;
}

export class AnthropicProvider implements ModelProvider {
  private embedDelegate: OpenAIProvider | null;

  constructor(private readonly cfg: AnthropicProviderConfig) {
    this.embedDelegate = cfg.hasOpenAIKey
      ? new OpenAIProvider({
          chatModel: cfg.chatModel,
          embeddingModel: cfg.embeddingModel,
          embeddingDimensions: cfg.embeddingDimensions,
        })
      : null;
  }

  async embed(texts: string[]): Promise<EmbedResult> {
    if (!this.embedDelegate) {
      throw new Error(
        "[AnthropicProvider] No embeddings backend configured. Set OPENAI_API_KEY to use OpenAI embeddings " +
          "alongside Anthropic chat, or switch MODEL_PROVIDER.",
      );
    }
    return this.embedDelegate.embed(texts);
  }

  async chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult> {
    const { text } = await generateText({
      model: anthropic(this.cfg.chatModel),
      messages,
      temperature: opts?.temperature ?? 0.2,
      maxTokens: opts?.maxTokens ?? 1024,
    });
    return { text, model: this.cfg.chatModel };
  }

  async structuredExtract<T>(input: string, schema: StructuredSchema<T>, opts?: ChatOptions): Promise<T> {
    const { text } = await generateText({
      model: anthropic(this.cfg.chatModel),
      temperature: opts?.temperature ?? 0,
      maxTokens: opts?.maxTokens ?? 2048,
      messages: [
        {
          role: "system",
          content:
            `${schema.instruction}\n\nRespond with ONLY valid JSON matching this JSON Schema:\n` +
            `${JSON.stringify(schema.jsonSchema)}\nNo prose, no markdown, no code fences.`,
        },
        { role: "user", content: input },
      ],
    });
    const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    return schema.parse(JSON.parse(trimmed));
  }
}
