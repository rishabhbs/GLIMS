/**
 * Provider factory. Selects the concrete ModelProvider by env (MODEL_PROVIDER).
 * Memoized per process.
 */
import type { ModelProvider } from "./types";
import { OpenAIProvider } from "./openai";
import { AnthropicProvider } from "./anthropic";
import { GoogleProvider } from "./google";
import { BedrockProvider } from "./bedrock";
import { MockProvider } from "./mock";
import { getServerConfig } from "@/config/env";

import type { WebResearchProvider } from "./web-research";
import { GeminiWebResearchProvider } from "./gemini-research";
import { MockWebResearchProvider } from "./mock-web-research";

export type { ModelProvider, ChatMessage, ChatResult, EmbedResult, StructuredSchema } from "./types";
export type { WebResearchProvider, WebResearchOutput, ResearchSource } from "./web-research";

let provider: ModelProvider | null = null;
let webProvider: WebResearchProvider | null = null;

export function getModelProvider(): ModelProvider {
  if (provider) return provider;
  const { model } = getServerConfig();

  switch (model.provider) {
    case "openai":
      provider = new OpenAIProvider({
        chatModel: model.chatModel,
        embeddingModel: model.embeddingModel,
        embeddingDimensions: model.embeddingDimensions,
      });
      break;
    case "anthropic":
      provider = new AnthropicProvider({
        chatModel: model.chatModel,
        embeddingModel: model.embeddingModel,
        embeddingDimensions: model.embeddingDimensions,
        hasOpenAIKey: Boolean(model.openaiApiKey),
      });
      break;
    case "google":
      provider = new GoogleProvider({
        chatModel: model.chatModel,
        embeddingModel: model.embeddingModel,
        embeddingDimensions: model.embeddingDimensions,
        apiKey: model.googleApiKey ?? "",
      });
      break;
    case "bedrock":
      provider = new BedrockProvider({
        chatModel: model.chatModel,
        region: model.bedrockRegion,
        apiKey: model.bedrockApiKey ?? "",
        embeddingModel: model.embeddingModel,
        embeddingDimensions: model.embeddingDimensions,
      });
      break;
    case "mock":
    default:
      provider = new MockProvider(model.embeddingDimensions);
      break;
  }
  return provider;
}

export function getWebResearchProvider(): WebResearchProvider {
  if (webProvider) return webProvider;
  const { research } = getServerConfig();
  switch (research.provider) {
    case "gemini":
      webProvider = new GeminiWebResearchProvider({
        apiKey: research.googleApiKey ?? "",
        model: research.geminiResearchModel,
      });
      break;
    case "mock":
    default:
      webProvider = new MockWebResearchProvider();
      break;
  }
  return webProvider;
}
