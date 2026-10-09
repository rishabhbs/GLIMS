/**
 * ImageProvider — vendor-agnostic raster image generation.
 *
 * Kept behind its own interface (like ModelProvider) so the engine doesn't
 * couple to a vendor. Default impl: OpenAI gpt-image-1 (the model behind the
 * Cybit reference images). A Bedrock impl can be added if/when the account's
 * SCP permits an image-gen region.
 */

export interface GenerateImageInput {
  prompt: string;
  /** Square by default (LinkedIn post image). */
  size?: "1024x1024" | "1536x1024" | "1024x1536";
  /** Transparent background when the composition will frame it; else white. */
  background?: "transparent" | "opaque";
}

export interface GenerateImageResult {
  /** PNG as a base64 string (no data: prefix). */
  base64: string;
  model: string;
}

export interface ImageProvider {
  generateImage(input: GenerateImageInput): Promise<GenerateImageResult>;
}

/** OpenAI gpt-image-1 via the Images API. */
export class OpenAIImageProvider implements ImageProvider {
  constructor(private readonly apiKey: string, private readonly model = "gpt-image-1") {
    if (!apiKey) {
      throw new Error("[OpenAIImageProvider] Missing OPENAI_API_KEY. Set it in .env.local to generate images.");
    }
  }

  async generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        prompt: input.prompt,
        n: 1,
        size: input.size ?? "1024x1024",
        background: input.background ?? "transparent",
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`[OpenAIImageProvider] ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error("[OpenAIImageProvider] No image returned.");
    return { base64: b64, model: this.model };
  }
}

let imageProvider: ImageProvider | null = null;

/** Factory. Returns null (not throw) when no image key is configured, so the
 *  app degrades gracefully to no-image rather than crashing. */
export function getImageProvider(): ImageProvider | null {
  if (imageProvider) return imageProvider;
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  imageProvider = new OpenAIImageProvider(key, process.env.OPENAI_IMAGE_MODEL || "gpt-image-1");
  return imageProvider;
}
