/**
 * Structured-extraction schema for knowledge items. Backs StructuredSchema<T>
 * with Zod and a JSON Schema the provider is told to emit.
 *
 * The extraction contract enforces obligation 9 (never invent): the model must
 * return, for each claim, the EXACT supporting snippet copied from the source.
 * Items without a verbatim snippet are dropped downstream.
 */
import { z } from "zod";
import type { StructuredSchema } from "@/providers/types";

export const ExtractedItemSchema = z.object({
  entity_type: z.string(),
  title: z.string().min(1),
  claim: z.string().min(1),
  body: z.string().nullable().optional(),
  source_classification: z.enum(["extracted", "inferred"]).default("extracted"),
  confidence: z.number().min(0).max(1).default(0.6),
  evidence_snippet: z.string().min(1),
  attributes: z.record(z.unknown()).default({}),
});

export const ExtractionResultSchema = z.object({
  items: z.array(ExtractedItemSchema).default([]),
});

export type ExtractedItem = z.infer<typeof ExtractedItemSchema>;
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

const JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["entity_type", "title", "claim", "evidence_snippet"],
        properties: {
          entity_type: { type: "string" },
          title: { type: "string" },
          claim: { type: "string" },
          body: { type: ["string", "null"] },
          source_classification: { type: "string", enum: ["extracted", "inferred"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          evidence_snippet: { type: "string" },
          attributes: { type: "object" },
        },
      },
    },
  },
};

/** Optional product context so extraction is scoped to the right product. */
export interface ExtractionProduct {
  name: string;
  oneLiner?: string;
}

export function buildExtractionSchema(
  entityTypeKeys: string[],
  product?: ExtractionProduct,
): StructuredSchema<ExtractionResult> {
  const subject = product
    ? `the product '${product.name}'${product.oneLiner ? ` (${product.name} is ${product.oneLiner})` : ""}`
    : "the product the text describes";
  return {
    name: "knowledge_extraction",
    jsonSchema: JSON_SCHEMA,
    parse: (raw) => ExtractionResultSchema.parse(raw),
    instruction:
      `You extract atomic product-knowledge items about ${subject} from the provided text.\n` +
      "Rules:\n" +
      "- Produce ONE claim per item. Keep each claim a single, self-contained statement.\n" +
      `- Choose entity_type from exactly these keys: ${entityTypeKeys.join(", ")}.\n` +
      "- NEVER invent capabilities, metrics, customer results, numbers, or facts not present in the text.\n" +
      "- For every item, 'evidence_snippet' MUST be an EXACT substring copied verbatim from the input text that supports the claim. Do not paraphrase the snippet.\n" +
      "- Use source_classification 'extracted' when the claim is stated in the text; use 'inferred' only for a clearly-labeled interpretation, with lower confidence.\n" +
      "- If the text contains no durable product knowledge, return an empty items array.\n" +
      "- 'attributes' may carry type-specific fields (e.g. for a metric: {value, unit}); otherwise {}.",
  };
}
