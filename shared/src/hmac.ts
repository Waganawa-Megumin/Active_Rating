// Active Rating — HMAC request signing/verification (design v1.0 §9 verifyHmac).
//
// Runtime-neutral: uses the Web Crypto API (`globalThis.crypto.subtle`), which
// is present and identical in both Node 22 and Cloudflare Workers, so this exact
// code runs on the scanner (sign) and worker (verify) sides.
//
// Signing string (newline-joined, LF):
//   AR1
//   <METHOD>
//   <PATH>
//   <X-AR-Timestamp>
//   <X-AR-Body-Sha256>
//
// The body hash binds the exact request bytes; the timestamp bounds replay.

export const SIG_VERSION = 'AR1';
export const REPLAY_WINDOW_SEC = 300;

export const HEADERS = {
  timestamp: 'x-ar-timestamp',
  bodyHash: 'x-ar-body-sha256',
  signature: 'x-ar-signature',
  keyId: 'x-ar-key-id',
} as const;

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes =
    typeof data === 'string'
      ? enc.encode(data)
      : data instanceof Uint8Array
        ? data
        : new Uint8Array(data);
  // Copy into a fresh ArrayBuffer to satisfy the BufferSource type across runtimes.
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice());
  return toHex(digest);
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return toHex(sig);
}

/** Constant-time comparison of two equal-length hex strings. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function signingString(
  method: string,
  path: string,
  timestamp: string,
  bodyHash: string,
): string {
  return [SIG_VERSION, method.toUpperCase(), path, timestamp, bodyHash].join('\n');
}

export type SignedHeaders = Record<string, string>;

/**
 * Produce the signed request headers for a JSON POST.
 * `bodyBytes` MUST be the exact bytes that will be transmitted.
 */
export async function signRequest(opts: {
  secret: string;
  method: string;
  path: string;
  bodyBytes: Uint8Array;
  keyId?: string;
  nowSec?: number;
}): Promise<SignedHeaders> {
  const timestamp = String(opts.nowSec ?? Math.floor(Date.now() / 1000));
  const bodyHash = await sha256Hex(opts.bodyBytes);
  const signature = await hmacHex(
    opts.secret,
    signingString(opts.method, opts.path, timestamp, bodyHash),
  );
  return {
    [HEADERS.timestamp]: timestamp,
    [HEADERS.bodyHash]: bodyHash,
    [HEADERS.signature]: signature,
    [HEADERS.keyId]: opts.keyId ?? 'default',
    'content-type': 'application/json',
  };
}

export type VerifyResult =
  | { ok: true; keyId: string }
  | { ok: false; status: 401 | 400; reason: string };

/**
 * Verify a signed request. `rawBody` must be the exact received bytes — the
 * caller must read the body BEFORE JSON.parse (parsing then re-serializing would
 * change the bytes and break the body hash).
 */
export async function verifyHmac(opts: {
  secret: string;
  method: string;
  path: string;
  headers: Headers;
  rawBody: Uint8Array;
  nowSec?: number;
  replayWindowSec?: number;
}): Promise<VerifyResult> {
  const ts = opts.headers.get(HEADERS.timestamp);
  const bodyHash = opts.headers.get(HEADERS.bodyHash);
  const signature = opts.headers.get(HEADERS.signature);
  const keyId = opts.headers.get(HEADERS.keyId) ?? 'default';

  if (!ts || !bodyHash || !signature) {
    return { ok: false, status: 400, reason: 'missing signature headers' };
  }

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) {
    return { ok: false, status: 400, reason: 'invalid timestamp' };
  }

  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const window = opts.replayWindowSec ?? REPLAY_WINDOW_SEC;
  if (Math.abs(now - tsNum) > window) {
    return { ok: false, status: 401, reason: 'stale timestamp (replay window)' };
  }

  // Bind the body: recompute and compare in constant time.
  const actualBodyHash = await sha256Hex(opts.rawBody);
  if (!timingSafeEqualHex(actualBodyHash, bodyHash)) {
    return { ok: false, status: 401, reason: 'body hash mismatch' };
  }

  const expected = await hmacHex(
    opts.secret,
    signingString(opts.method, opts.path, ts, bodyHash),
  );
  if (!timingSafeEqualHex(expected, signature)) {
    return { ok: false, status: 401, reason: 'bad signature' };
  }

  return { ok: true, keyId };
}
