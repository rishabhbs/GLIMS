/**
 * OpenAIProvider — default concrete ModelProvider, built on the Vercel AI SDK.
 * The AI SDK is used ONLY inside this file; the rest of the app depends on the
 * ModelProvider interface.
 */
import { openai } from "@ai-sdk/openai";
import { embedMany, generateText } from "ai";
import type { ChatMessage, ChatOptions, ChatResult, EmbedResult, ModelProvider, StructuredSchema } from "./types";

export interface OpenAIProviderConfig {
  chatModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
}

export class OpenAIProvider implements ModelProvider {
  constructor(private readonly cfg: OpenAIProviderConfig) {}

  async embed(texts: string[]): Promise<EmbedResult> {
    const { embeddings } = await embedMany({
      model: openai.embedding(this.cfg.embeddingModel),
      values: texts,
    });
    return { vectors: embeddings, model: this.cfg.embeddingModel };
  }

  async chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult> {
    const { text } = await generateText({
      model: openai(this.cfg.chatModel),
      messages,
      temperature: opts?.temperature ?? 0.2,
      maxTokens: opts?.maxTokens,
    });
    return { text, model: this.cfg.chatModel };
  }

  async structuredExtract<T>(input: string, schema: StructuredSchema<T>, opts?: ChatOptions): Promise<T> {
    const { text } = await generateText({
      model: openai(this.cfg.chatModel),
      temperature: opts?.temperature ?? 0,
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
    });
    return schema.parse(parseJsonLoose(text));
  }
}

/** Tolerate models that wrap JSON in code fences. */
function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  return JSON.parse(trimmed);
}
