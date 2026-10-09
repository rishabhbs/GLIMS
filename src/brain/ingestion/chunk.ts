/**
 * Chunking: split normalized text into overlapping, retrievable spans.
 * Each chunk carries a char-range locator so evidence can point back precisely.
 *
 * Strategy: paragraph-aware greedy packing to a target size with overlap.
 */

export interface Chunk {
  ordinal: number;
  content: string;
  locator: { char_start: number; char_end: number };
}

export interface ChunkOptions {
  targetChars?: number; // approx chunk size
  overlapChars?: number; // overlap between consecutive chunks
}

export function chunkText(text: string, opts: ChunkOptions = {}): Chunk[] {
  const targetChars = opts.targetChars ?? 1200;
  const overlapChars = opts.overlapChars ?? 150;
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean === "") return [];

  // Split on paragraph boundaries but keep offsets.
  const paragraphs: Array<{ text: string; start: number }> = [];
  const re = /\n{2,}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    paragraphs.push({ text: clean.slice(last, m.index), start: last });
    last = m.index + m[0].length;
  }
  paragraphs.push({ text: clean.slice(last), start: last });

  const chunks: Chunk[] = [];
  let buf = "";
  let bufStart = 0;
  let ordinal = 0;

  const flush = (end: number) => {
    const content = buf.trim();
    if (content === "") return;
    const start = bufStart + (buf.length - buf.trimStart().length);
    chunks.push({ ordinal: ordinal++, content, locator: { char_start: start, char_end: end } });
  };

  for (const p of paragraphs) {
    const piece = p.text.trim();
    if (piece === "") continue;

    if (buf === "") {
      buf = piece;
      bufStart = p.start;
    } else if (buf.length + piece.length + 2 <= targetChars) {
      buf += "\n\n" + piece;
    } else {
      const end = bufStart + buf.length;
      flush(end);
      // Start next buffer with overlap tail of the previous one.
      const tail = buf.slice(Math.max(0, buf.length - overlapChars));
      buf = tail ? tail + "\n\n" + piece : piece;
      bufStart = p.start - (tail ? tail.length + 2 : 0);
    }

    // A single oversized paragraph: hard-split it.
    while (buf.length > targetChars * 1.5) {
      const cut = targetChars;
      const end = bufStart + cut;
      const slice = buf.slice(0, cut);
      chunks.push({
        ordinal: ordinal++,
        content: slice.trim(),
        locator: { char_start: bufStart, char_end: end },
      });
      const rest = buf.slice(cut - overlapChars);
      bufStart = end - overlapChars;
      buf = rest;
    }
  }
  if (buf.trim() !== "") flush(bufStart + buf.length);

  return chunks;
}
