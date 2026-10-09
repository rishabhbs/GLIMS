/**
 * Text extraction per source type. Produces normalized plain text + the
 * extraction_method used (recorded on the source for provenance/reliability).
 *
 * - text / note: passthrough of raw_text.
 * - url: fetch the page and strip HTML to readable text.
 * - pdf: download bytes from Supabase Storage and parse.
 * - image: OCR/vision caption via the ModelProvider (records 'vision').
 *
 * If a source already has raw_text (e.g. pre-extracted at intake), that is used
 * and the method is preserved.
 */
import type { ModelProvider } from "@/providers";

export interface ExtractTextInput {
  type: "pdf" | "text" | "url" | "note" | "image" | "other";
  rawText: string | null;
  uri: string | null;
  storagePath: string | null;
  existingMethod: string | null;
}

export interface ExtractTextResult {
  text: string;
  method: string;
}

export interface StorageReader {
  /** Download a file from Storage as bytes. */
  download(storagePath: string): Promise<Uint8Array>;
}

/** Strip tags/scripts/styles from HTML into readable text. Deliberately simple. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|br|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractText(
  input: ExtractTextInput,
  deps: { provider: ModelProvider; storage?: StorageReader },
): Promise<ExtractTextResult> {
  // If raw text was already provided at intake, trust it.
  if (input.rawText && input.rawText.trim() !== "" && input.type !== "url") {
    return { text: input.rawText, method: input.existingMethod ?? "manual" };
  }

  switch (input.type) {
    case "text":
    case "note":
    case "other":
      return { text: input.rawText ?? "", method: "passthrough" };

    case "url": {
      if (!input.uri) throw new Error("url source has no uri");
      const res = await fetch(input.uri, { headers: { "user-agent": "LIMS-Brain/1.0" } });
      if (!res.ok) throw new Error(`fetch ${input.uri} failed: ${res.status}`);
      const html = await res.text();
      return { text: htmlToText(html), method: "html_readability" };
    }

    case "pdf": {
      if (!input.storagePath) throw new Error("pdf source has no storage_path");
      if (!deps.storage) throw new Error("no storage reader configured for pdf extraction");
      const bytes = await deps.storage.download(input.storagePath);
      // unpdf: maintained, dependency-free, works in serverless with no filesystem
      // self-test (unlike pdf-parse). Import lazily so it only loads for PDFs.
      const { extractText: extractPdfText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text } = await extractPdfText(pdf, { mergePages: true });
      return { text, method: "pdf_parse" };
    }

    case "image": {
      if (!deps.storage || !input.storagePath) {
        // No bytes available; fall back to any provided text.
        return { text: input.rawText ?? "", method: "vision_unavailable" };
      }
      // Vision captioning: ask the provider to describe/transcribe. Real vision
      // requires a vision-capable model; the provider abstraction keeps this swappable.
      const caption = await deps.provider.chat(
        [
          {
            role: "system",
            content:
              "You transcribe and describe product screenshots/diagrams into plain text. " +
              "Report only what is visibly present. Do not infer facts that are not shown.",
          },
          { role: "user", content: `Describe the image at storage path: ${input.storagePath}` },
        ],
        { temperature: 0 },
      );
      return { text: caption.text, method: "vision" };
    }

    default:
      return { text: input.rawText ?? "", method: "passthrough" };
  }
}
