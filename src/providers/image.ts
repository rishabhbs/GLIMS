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

/**
 * Azure OpenAI image generation (gpt-image-1 / gpt-image-1.5 on Azure Foundry).
 *
 * Uses the v1 data-plane shape (per Azure docs for the gpt-image series):
 *   POST {endpoint}/openai/v1/images/generations?api-version=preview
 *   header:  api-key: {key}
 *   body:    { model: <deployment>, prompt, size, n, quality, output_format,
 *              background? }
 * The deployment name goes in the body as `model` (NOT in the URL). The gpt-image
 * series always returns base64 in data[0].b64_json (response_format unsupported).
 */
export class AzureImageProvider implements ImageProvider {
  private readonly endpoint: string;

  constructor(
    endpoint: string,
    private readonly apiKey: string,
    private readonly deployment: string,
    private readonly apiVersion = "preview",
  ) {
    if (!endpoint) throw new Error("[AzureImageProvider] Missing AZURE_IMAGE_ENDPOINT.");
    if (!apiKey) throw new Error("[AzureImageProvider] Missing AZURE_IMAGE_APIKEY.");
    if (!deployment) throw new Error("[AzureImageProvider] Missing AZURE_IMAGE_DEPLOYMENT.");
    this.endpoint = endpoint.replace(/\/+$/, "");
  }

  async generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
    const url = `${this.endpoint}/openai/v1/images/generations?api-version=${encodeURIComponent(this.apiVersion)}`;
    const transparent = (input.background ?? "transparent") === "transparent";
    const res = await fetch(url, {
      method: "POST",
      headers: { "api-key": this.apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.deployment,
        prompt: input.prompt,
        n: 1,
        size: input.size ?? "1024x1024",
        quality: "high",
        output_format: "png",
        // transparency is gpt-image-1 series only and requires PNG output.
        ...(transparent ? { background: "transparent" } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`[AzureImageProvider] ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
    const item = json.data?.[0];
    if (item?.b64_json) return { base64: item.b64_json, model: this.deployment };
    if (item?.url) {
      const imgRes = await fetch(item.url);
      if (!imgRes.ok) throw new Error(`[AzureImageProvider] image fetch ${imgRes.status}`);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      return { base64: buf.toString("base64"), model: this.deployment };
    }
    throw new Error("[AzureImageProvider] No image returned.");
  }
}

let imageProvider: ImageProvider | null = null;

/** Factory. Returns null (not throw) when no image key is configured, so the
 *  app degrades gracefully to no-image rather than crashing.
 *  Prefers Azure when its env is set, else OpenAI. */
export function getImageProvider(): ImageProvider | null {
  if (imageProvider) return imageProvider;

  const azureEndpoint = process.env.AZURE_IMAGE_ENDPOINT;
  const azureKey = process.env.AZURE_IMAGE_APIKEY;
  const azureDeployment = process.env.AZURE_IMAGE_DEPLOYMENT;
  if (azureEndpoint && azureKey && azureDeployment) {
    imageProvider = new AzureImageProvider(
      azureEndpoint,
      azureKey,
      azureDeployment,
      process.env.AZURE_IMAGE_API_VERSION || "preview",
    );
    return imageProvider;
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  imageProvider = new OpenAIImageProvider(key, process.env.OPENAI_IMAGE_MODEL || "gpt-image-1");
  return imageProvider;
}
