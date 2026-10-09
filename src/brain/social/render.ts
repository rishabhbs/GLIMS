/**
 * Branded frame renderer — wraps a generated illustration in the Cybit /
 * Sampleify brand layout (matches the reference ad style): light background,
 * subtle grey border, DEEPAK CYBIT logo blob top-right, a big two-tone serif
 * headline, a body line, an orange swoosh, a "Learn more at cybit.in" pill, and
 * a "Sampleify LIMS" footer. Rendered with Satori -> SVG -> resvg -> PNG.
 *
 * The ILLUSTRATION is produced by the image model (OpenAI) and passed in as a
 * data URL; this module only does the on-brand composition + typography.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

const W = 1080;
const H = 1350; // 4:5 portrait, LinkedIn's best-performing ratio

// Cybit brand tokens (from the reference set + logo).
const C = {
  bg: "#FFFFFF",
  bgSoft: "#F4F6FB",
  border: "#C9CDD6",
  ink: "#1E3A8A",       // dark navy (headline / body)
  blue: "#2563EB",      // bright royal blue
  orange: "#E8820E",    // accent
  orangeSoft: "#FBE7CC",
  grey: "#8A8F9A",
  serif: "Spectral",
  sans: "Hanken Grotesk",
};

const FONT_DIR = path.join(process.cwd(), "src/brain/social/fonts");
let fontsCache: Array<{ name: string; data: Buffer; weight: 400 | 600 | 700; style: "normal" }> | null = null;
function fonts() {
  if (fontsCache) return fontsCache;
  const read = (f: string) => readFileSync(path.join(FONT_DIR, f));
  fontsCache = [
    { name: C.serif, data: read("Spectral-Regular.ttf"), weight: 400, style: "normal" },
    { name: C.serif, data: read("Spectral-SemiBold.ttf"), weight: 600, style: "normal" },
    { name: C.sans, data: read("Hanken-400.ttf"), weight: 400, style: "normal" },
    { name: C.sans, data: read("Hanken-600.ttf"), weight: 600, style: "normal" },
    { name: C.sans, data: read("Hanken-700.ttf"), weight: 700, style: "normal" },
  ];
  return fontsCache;
}

// Logo as a data URL (if the asset is present).
let logoCache: string | null | undefined;
function logoDataUrl(): string | null {
  if (logoCache !== undefined) return logoCache;
  const candidates = ["logo-s.png", "logo-xs.png", "logo-xl.png"];
  for (const name of candidates) {
    const p = path.join(process.cwd(), "visual assets", name);
    if (existsSync(p)) {
      logoCache = `data:image/png;base64,${readFileSync(p).toString("base64")}`;
      return logoCache;
    }
  }
  logoCache = null;
  return null;
}

type Style = Record<string, unknown>;
type Node = { type: string; props: { style?: Style; children?: unknown } };
const box = (style: Style, children?: unknown): Node => ({ type: "div", props: { style: { display: "flex", ...style }, children } });
const text = (content: string, style: Style): Node => ({ type: "div", props: { style: { display: "flex", ...style }, children: content } });
const img = (src: string, style: Style): Node => ({ type: "img", props: { style, src } as unknown as { style: Style } });

export interface FrameSpec {
  /** headline — may contain two "sentences"; both render, second in blue. */
  headline: string;
  /** supporting body line. */
  body: string;
  /** optional call-to-action text, e.g. "Learn more at cybit.in". */
  cta?: string;
  /** the generated illustration as a PNG data URL (data:image/png;base64,...). */
  illustration?: string | null;
}

/** Split a headline like "Connect. Automate." into two tone parts. */
function headlineParts(h: string): [string, string | null] {
  const m = h.trim().match(/^(.*?[.!?])\s*(.+)$/);
  if (m && m[2]) return [m[1], m[2]];
  return [h, null];
}

function build(spec: FrameSpec): Node {
  const logo = logoDataUrl();
  const [h1, h2] = headlineParts(spec.headline);

  return box(
    { width: W, height: H, position: "relative", backgroundColor: C.bg, flexDirection: "column" },
    [
      // thin outer border frame
      box({ position: "absolute", top: 10, left: 10, width: W - 20, height: H - 20, border: `10px solid ${C.bgSoft}`, borderRadius: 8 }),

      // logo top-right
      logo
        ? img(logo, { position: "absolute", top: 54, right: 54, width: 150, height: 150, objectFit: "contain" })
        : box({ position: "absolute", top: 54, right: 54, width: 150, height: 60, backgroundColor: C.orange, borderRadius: 30 }),

      // illustration zone (top ~55%)
      box({ position: "relative", width: W, height: 740, alignItems: "center", justifyContent: "center", paddingTop: 40 },
        spec.illustration
          ? [img(spec.illustration, { width: 820, height: 680, objectFit: "contain" })]
          : [box({ width: 760, height: 560, borderRadius: 24, backgroundColor: C.bgSoft, alignItems: "center", justifyContent: "center" },
              [text("illustration", { color: C.grey, fontSize: 28 })])],
      ),

      // orange swoosh accent (bottom-right curve)
      box({ position: "absolute", right: -120, top: 760, width: 520, height: 320, backgroundColor: C.orangeSoft, borderRadius: 260, opacity: 0.9 }),

      // text block (bottom ~45%)
      box({ position: "relative", flexDirection: "column", paddingLeft: 72, paddingRight: 72, marginTop: 10 }, [
        box({ alignItems: "baseline", flexWrap: "wrap" }, [
          text(h1, { fontFamily: C.serif, fontSize: 92, fontWeight: 600, color: C.orange, lineHeight: 1.05, marginRight: 20 }),
          h2 ? text(h2, { fontFamily: C.serif, fontSize: 92, fontWeight: 600, color: C.orange, lineHeight: 1.05 }) : box({}),
        ]),
        text(spec.body, { fontFamily: C.sans, fontSize: 38, color: C.ink, lineHeight: 1.4, marginTop: 24, maxWidth: 860 }),
      ]),

      // footer: CTA pill (left) + Sampleify LIMS (right)
      box({ position: "absolute", left: 72, right: 72, bottom: 70, alignItems: "center", justifyContent: "space-between" }, [
        spec.cta
          ? box({ backgroundColor: "#FDF4E6", border: `2px solid ${C.orangeSoft}`, borderRadius: 40, padding: "18px 34px" },
              [text(spec.cta, { fontFamily: C.sans, fontSize: 32, color: C.ink })])
          : box({}),
        text("Sampleify LIMS", { fontFamily: C.sans, fontSize: 32, color: C.grey }),
      ]),
    ],
  );
}

export async function renderFrameToSvg(spec: FrameSpec): Promise<string> {
  return satori(build(spec) as unknown as React.ReactNode, { width: W, height: H, fonts: fonts() });
}

export async function renderFrameToPngDataUrl(spec: FrameSpec): Promise<string> {
  const svg = await renderFrameToSvg(spec);
  const png = new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}
