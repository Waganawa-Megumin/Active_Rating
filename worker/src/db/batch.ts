// Active Rating — chunked D1 batch helper.
//
// Cloudflare D1's batch() accepts a bounded number of statements per call; a
// large scan (crt.sh can yield hundreds of subdomains + certs, each expanding
// to insert+change statements) overruns that limit and the whole ingest 5xxes —
// even though the same payload passes against the local SQLite shim, which has
// no such cap. Splitting into sub-batches keeps every call safely under the
// limit. Atomicity is per-chunk, not global; a partial failure is reconciled by
// the next scan (the diff is idempotent by design).

/** D1 batch statement ceiling we stay under (conservative). */
export const D1_BATCH_CHUNK = 50;

/** Execute prepared statements in ordered sub-batches of at most `size`. */
export async function batchChunked(
  db: D1Database,
  stmts: D1PreparedStatement[],
  size: number = D1_BATCH_CHUNK,
): Promise<void> {
  if (stmts.length === 0) return;
  if (stmts.length <= size) {
    await db.batch(stmts);
    return;
  }
  for (let i = 0; i < stmts.length; i += size) {
    await db.batch(stmts.slice(i, i + size));
  }
}
