import { describe, expect, it } from 'vitest';
import { signRequest, verifyHmac, HEADERS, sha256Hex, timingSafeEqualHex } from '../src/hmac.js';

const enc = new TextEncoder();
const SECRET = 'test-secret-0123456789';

function headersFrom(obj: Record<string, string>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(obj)) h.set(k, v);
  return h;
}

describe('hmac sign/verify', () => {
  it('round-trips a valid signature', async () => {
    const body = enc.encode(JSON.stringify({ hello: 'world' }));
    const signed = await signRequest({
      secret: SECRET,
      method: 'POST',
      path: '/ingest',
      bodyBytes: body,
      nowSec: 1000,
    });
    const res = await verifyHmac({
      secret: SECRET,
      method: 'POST',
      path: '/ingest',
      headers: headersFrom(signed),
      rawBody: body,
      nowSec: 1000,
    });
    expect(res.ok).toBe(true);
  });

  it('rejects a tampered body', async () => {
    const body = enc.encode(JSON.stringify({ hello: 'world' }));
    const signed = await signRequest({
      secret: SECRET,
      method: 'POST',
      path: '/ingest',
      bodyBytes: body,
      nowSec: 1000,
    });
    const tampered = enc.encode(JSON.stringify({ hello: 'evil' }));
    const res = await verifyHmac({
      secret: SECRET,
      method: 'POST',
      path: '/ingest',
      headers: headersFrom(signed),
      rawBody: tampered,
      nowSec: 1000,
    });
    expect(res.ok).toBe(false);
  });

  it('rejects a wrong secret', async () => {
    const body = enc.encode('{}');
    const signed = await signRequest({
      secret: SECRET,
      method: 'POST',
      path: '/ingest',
      bodyBytes: body,
      nowSec: 1000,
    });
    const res = await verifyHmac({
      secret: 'other-secret',
      method: 'POST',
      path: '/ingest',
      headers: headersFrom(signed),
      rawBody: body,
      nowSec: 1000,
    });
    expect(res.ok).toBe(false);
  });

  it('rejects a stale timestamp (replay window)', async () => {
    const body = enc.encode('{}');
    const signed = await signRequest({
      secret: SECRET,
      method: 'POST',
      path: '/ingest',
      bodyBytes: body,
      nowSec: 1000,
    });
    const res = await verifyHmac({
      secret: SECRET,
      method: 'POST',
      path: '/ingest',
      headers: headersFrom(signed),
      rawBody: body,
      nowSec: 1000 + 9999,
    });
    expect(res.ok).toBe(false);
  });

  it('rejects missing headers with 400', async () => {
    const res = await verifyHmac({
      secret: SECRET,
      method: 'POST',
      path: '/ingest',
      headers: headersFrom({ [HEADERS.timestamp]: '1000' }),
      rawBody: enc.encode('{}'),
      nowSec: 1000,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
  });
});

describe('helpers', () => {
  it('sha256Hex matches a known vector', async () => {
    // SHA-256("") = e3b0c442...
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('timingSafeEqualHex compares correctly', () => {
    expect(timingSafeEqualHex('abcd', 'abcd')).toBe(true);
    expect(timingSafeEqualHex('abcd', 'abce')).toBe(false);
    expect(timingSafeEqualHex('abcd', 'abcde')).toBe(false);
  });
});
