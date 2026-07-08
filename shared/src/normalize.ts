// Active Rating — normalization rules (design v0.1 §6).
//
// Applied before building identity/attributes so cosmetic churn (record order,
// TTL, Date/Server headers, body byte changes) never emits a false CHANGED.
// The scanner normalizes; the worker re-asserts defensively.

import { sha256Hex } from './hmac.js';

/** Volatile fields dropped before comparison (case-insensitive key match). */
const VOLATILE_KEYS = new Set(
  ['ttl', 'date', 'server', 'age', 'expires', 'last-modified', 'x-request-id'].map((k) =>
    k.toLowerCase(),
  ),
);

type Json = unknown;

/**
 * Recursively canonicalize a JSON-ish value:
 *  - object keys sorted, volatile keys removed
 *  - arrays of primitives sorted (order-independent comparison)
 *  - strings left as-is (host lowercasing is done in identity.ts where semantic)
 */
export function canonicalize(value: Json): Json {
  if (Array.isArray(value)) {
    const mapped = value.map(canonicalize);
    // Sort only when every element is a primitive (stable, order-independent).
    if (mapped.every((v) => v === null || typeof v !== 'object')) {
      return [...mapped].sort((a, b) => String(a).localeCompare(String(b)));
    }
    // Arrays of objects: canonicalize each, then sort by their JSON form.
    return [...mapped].sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, Json>;
    const out: Record<string, Json> = {};
    for (const key of Object.keys(obj).sort()) {
      if (VOLATILE_KEYS.has(key.toLowerCase())) continue;
      out[key] = canonicalize(obj[key]);
    }
    return out;
  }
  return value;
}

/** Deterministic JSON string of a canonicalized value (for hashing/compare). */
export function canonicalJson(value: Json): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Normalize an entity's attributes. If a large `body` field is present it is
 * replaced with `body_sha256` to shrink diffs and kill byte-level churn.
 */
export async function normalizeAttributes(
  attrs: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const clone: Record<string, unknown> = { ...attrs };
  if (typeof clone.body === 'string') {
    clone.body_sha256 = await sha256Hex(clone.body);
    delete clone.body;
  }
  return canonicalize(clone) as Record<string, unknown>;
}

/** True when two attribute sets are equal after canonicalization. */
export function attributesEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  return canonicalJson(a) === canonicalJson(b);
}
