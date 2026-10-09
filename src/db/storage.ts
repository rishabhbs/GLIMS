/**
 * Supabase Storage access (server-only, service role). Holds original files
 * (PDFs, images) for provenance. The bucket is created lazily if missing.
 */
import { getServiceClient } from "./client";
import type { StorageReader } from "@/brain/ingestion/extract-text";

export const SOURCE_BUCKET = "sources";

async function ensureBucket() {
  const db = getServiceClient();
  const { data } = await db.storage.getBucket(SOURCE_BUCKET);
  if (!data) {
    await db.storage.createBucket(SOURCE_BUCKET, { public: false });
  }
}

/** Upload raw bytes and return the storage path. */
export async function uploadSourceFile(
  path: string,
  bytes: ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<string> {
  await ensureBucket();
  const db = getServiceClient();
  const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const { error } = await db.storage.from(SOURCE_BUCKET).upload(path, body, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
  return path;
}

/** StorageReader used by the ingestion worker for PDF/image extraction. */
export const supabaseStorageReader: StorageReader = {
  async download(storagePath: string): Promise<Uint8Array> {
    const db = getServiceClient();
    const { data, error } = await db.storage.from(SOURCE_BUCKET).download(storagePath);
    if (error || !data) throw error ?? new Error(`download failed: ${storagePath}`);
    const buf = await data.arrayBuffer();
    return new Uint8Array(buf);
  },
};
