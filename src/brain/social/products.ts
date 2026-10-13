/**
 * Products + identity — GLIMS is a social-media intern for DEEPAK CYBIT, not a
 * promoter of one product.
 *
 * Two identity tiers feed every generation:
 *   - COMPANY identity (shared, always applies): who the writer is (Cybit's
 *     social intern), who signs the posts (Deepak Cybit), the house voice. This
 *     is the same no matter which product a post is for.
 *   - PRODUCT identity (per active product): what THIS product is, who it's for,
 *     how it's positioned. Swaps based on the product the post is being written
 *     for.
 *
 * Products live in the `products` table (see migration 0009). The active product
 * is chosen in the UI and threaded through the social deps.
 */
import { Repositories } from "@/db/repositories";

export interface Product {
  id: string;
  slug: string;
  name: string;
  /** One-line "<name> is <one_liner>" used inline in prompts. */
  oneLiner: string;
  /** Longer who-it-is / who-it's-for, injected as the product identity block. */
  positioning: string;
}

const WORKSPACE = "00000000-0000-0000-0000-000000000001";

function mapRow(r: {
  id: string;
  slug: string;
  name: string;
  one_liner: string;
  positioning: string;
}): Product {
  return { id: r.id, slug: r.slug, name: r.name, oneLiner: r.one_liner, positioning: r.positioning };
}

export async function listProducts(workspaceId: string = WORKSPACE): Promise<Product[]> {
  const rows = await new Repositories().listProducts(workspaceId);
  return rows.map(mapRow);
}

/** Resolve a product by id, else the first active product as a safe default. */
export async function resolveProduct(
  workspaceId: string = WORKSPACE,
  productId?: string | null,
): Promise<Product | null> {
  const repos = new Repositories();
  if (productId) {
    const row = await repos.getProduct(productId);
    if (row) return mapRow(row);
  }
  const list = await repos.listProducts(workspaceId);
  return list.length ? mapRow(list[0]) : null;
}

export async function getProductBySlug(slug: string, workspaceId: string = WORKSPACE): Promise<Product | null> {
  const row = await new Repositories().getProductBySlug(workspaceId, slug);
  return row ? mapRow(row) : null;
}

// ── identity prompt blocks ───────────────────────────────────────────────────

/**
 * The COMPANY identity block — the writer's self-image. Shared across every
 * product. This is what makes GLIMS behave like Cybit's intern rather than one
 * product's mouthpiece.
 */
export const COMPANY_IDENTITY = `YOU ARE a sharp social-media writer on the marketing team at Deepak Cybit, a software company that builds industry-specific B2B products. You write LinkedIn posts for whichever Cybit product you are told to write for.
Posts are authored by a PERSON on the team (Deepak Cybit), writing in first person about the product, never as the product's corporate account. Sound like a practitioner who knows the domain, not a brand.
You have a shared understanding of how real industrial, lab, and compliance operations actually work (the REAL-WORLD FACTS and AUDIENCE notes, when present). Use it for any product. Never invent product capabilities, metrics, or customer results.`;

/** The PRODUCT identity block for the active product. */
export function renderProductIdentity(product: Product): string {
  return (
    `THIS POST IS FOR: ${product.name} — ${product.oneLiner}.\n` +
    `ABOUT ${product.name}: ${product.positioning}\n` +
    `Write specifically for ${product.name}. Do not describe or imply features of Cybit's other products.`
  );
}
