/**
 * Post graphic pipeline — fresh generative illustration per post, composed into
 * the Cybit / Sampleify brand frame.
 *
 *   1. ART BRIEF (Claude): post -> a concise scene description + headline/body/CTA.
 *   2. ILLUSTRATION (image model, OpenAI gpt-image-1): the brief rendered in a
 *      LOCKED flat-vector Cybit style (so every post looks like the brand set).
 *   3. COMPOSE (Satori): drop the illustration into the branded frame.
 *
 * If no image key is configured, we still return a branded frame (illustration
 * slot shows a placeholder) so the feature degrades gracefully.
 */
import type { ModelProvider } from "@/providers";
import { getImageProvider } from "@/providers/image";
import { renderFrameToSvg, renderFrameToPngDataUrl, type FrameSpec } from "./render";

export interface GenerateGraphicInput {
  body: string;
  theme?: string;
  direction?: string;
}

export interface GraphicResult {
  png: string;
  svg: string;
  spec: FrameSpec;
  /** True when a real illustration was generated (vs placeholder). */
  illustrated: boolean;
}

// LOCKED visual style — appended to every image prompt so output stays on-brand
// and consistent with the Cybit reference set.
const STYLE_LOCK =
  "Flat vector infographic illustration, clean modern corporate style. " +
  "Strict palette: white background, bright royal blue (#2563EB) and dark navy (#1E3A8A), a single warm orange accent (#E8820E), pale blue fills, soft grey-blue. " +
  "Simple rounded line-and-fill shapes, light soft shadows, friendly but professional. Thin line icons inside circles. " +
  "Subject is a laboratory / LIMS software theme (lab benches, instruments, dashboards, workflow diagrams, UI cards, checklists). " +
  "NO text or words in the image, NO logos, NO watermark, NO photorealism, NO 3D render, NO gradients-as-background. Centered composition with generous whitespace, transparent or white background.";

const BRIEF_SYSTEM = `You are an art director briefing an illustrator for a LinkedIn post about Sampleify LIMS (a lab information management system). Output a tight brief for ONE flat-vector infographic illustration that visualizes the post's core idea, plus the on-image text.

Return ONLY JSON:
{
  "scene": string,     // 1-2 sentences describing the illustration subject + key elements. Concrete and specific (e.g. "a weighing scale showing 125g beside a BOM clipboard, an orange variance warning between them, connected by an arrow to an ERP database icon"). NO style words — just the subject/elements. NO text-in-image.
  "headline": string,  // 2-4 words, punchy, ideally two short words with periods like "Connect. Automate." Drawn from the post.
  "body": string,      // one supporting sentence (<= 16 words).
  "cta": string        // short, e.g. "Learn more at cybit.in"
}
Keep the scene to elements an illustrator can draw cleanly: a hero object, 2-4 supporting icons/cards, connectors. Ground it in the post; never invent product features.`;

function parseJsonLoose(t: string): unknown {
  let s = t.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

interface Brief {
  scene: string;
  headline: string;
  body: string;
  cta: string;
}

async function makeBrief(input: GenerateGraphicInput, provider: ModelProvider): Promise<Brief> {
  const user =
    `POST:\n${input.body}\n\n` +
    (input.theme ? `THEME: ${input.theme}\n` : "") +
    (input.direction ? `ART DIRECTION (honor it): ${input.direction}\n` : "") +
    `\nWrite the brief as JSON.`;
  const res = await provider.chat(
    [
      { role: "system", content: BRIEF_SYSTEM },
      { role: "user", content: user },
    ],
    { temperature: 0.6, maxTokens: 700 },
  );
  const r = (parseJsonLoose(res.text) ?? {}) as Record<string, unknown>;
  const str = (v: unknown, d = "") => (typeof v === "string" && v.trim() ? v.trim() : d);
  return {
    scene: str(r.scene, "a laboratory dashboard with connected workflow icons"),
    headline: str(r.headline, input.theme ?? "Built for labs"),
    body: str(r.body, ""),
    cta: str(r.cta, "Learn more at cybit.in"),
  };
}

export async function generateGraphic(input: GenerateGraphicInput, provider: ModelProvider): Promise<GraphicResult> {
  // 1. Art brief.
  let brief: Brief;
  try {
    brief = await makeBrief(input, provider);
  } catch {
    brief = { scene: "lab workflow dashboard with connected icons", headline: input.theme ?? "Sampleify LIMS", body: "", cta: "Learn more at cybit.in" };
  }

  // 2. Generate the illustration (if an image provider is configured).
  let illustration: string | null = null;
  let illustrated = false;
  const imageProvider = getImageProvider();
  if (imageProvider) {
    try {
      const prompt =
        `${brief.scene}\n\n` +
        (input.direction ? `Art direction: ${input.direction}. ` : "") +
        STYLE_LOCK;
      const out = await imageProvider.generateImage({ prompt, size: "1024x1024", background: "transparent" });
      illustration = `data:image/png;base64,${out.base64}`;
      illustrated = true;
    } catch {
      // fall through to placeholder frame
    }
  }

  // 3. Compose into the branded frame.
  const spec: FrameSpec = { headline: brief.headline, body: brief.body, cta: brief.cta, illustration };
  const [svg, png] = await Promise.all([renderFrameToSvg(spec), renderFrameToPngDataUrl(spec)]);
  return { png, svg, spec, illustrated };
}
