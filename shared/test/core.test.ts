import { describe, expect, it } from 'vitest';
import { identityOf, assetIdOf } from '../src/identity.js';
import { canonicalJson, attributesEqual, normalizeAttributes } from '../src/normalize.js';
import { scoreConfidence } from '../src/confidence.js';
import { severityOf } from '../src/severity.js';
import type { NormalizedEntity } from '../src/types.js';

describe('identity', () => {
  it('canonicalizes hostnames', () => {
    expect(identityOf('subdomain', { fqdn: 'API.Example.com.' })).toBe('api.example.com');
  });
  it('builds dns + service keys', () => {
    expect(identityOf('dns', { name: 'a.b', type: 'a' })).toBe('a.b|A');
    expect(identityOf('service', { ip: '1.2.3.4', port: 443, proto: 'TCP' })).toBe(
      '1.2.3.4:443/tcp',
    );
  });
  it('asset_id is deterministic and salted by domain+type', async () => {
    const a = await assetIdOf('dom1', 'subdomain', 'api.example.com');
    const b = await assetIdOf('dom1', 'subdomain', 'api.example.com');
    const c = await assetIdOf('dom2', 'subdomain', 'api.example.com');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('normalize', () => {
  it('sorts arrays + keys and drops volatile fields', () => {
    const a = canonicalJson({ a: [3, 1, 2], ttl: 60, z: 1 });
    const b = canonicalJson({ z: 1, a: [1, 2, 3] });
    expect(a).toBe(b);
  });
  it('hashes body into body_sha256', async () => {
    const out = await normalizeAttributes({ status: 200, body: 'hello' });
    expect(out.body).toBeUndefined();
    expect(out.body_sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('attributesEqual ignores order + ttl churn', () => {
    expect(attributesEqual({ a: [2, 1], ttl: 1 }, { a: [1, 2], ttl: 999 })).toBe(true);
  });
});

describe('confidence', () => {
  it('promotes on active resolution', () => {
    const r = scoreConfidence({ active_resolved: true });
    expect(r.state).toBe('confirmed');
  });
  it('promotes on >=2 independent sources', () => {
    const r = scoreConfidence({ source_count: 2 });
    expect(r.state).toBe('confirmed');
  });
  it('stays candidate for a single weak source', () => {
    const r = scoreConfidence({ source_count: 1, shared_cdn: true });
    expect(r.state).toBe('candidate');
    expect(r.score).toBeLessThan(60);
  });
  it('clamps to 0..100', () => {
    const r = scoreConfidence({
      source_count: 99,
      active_resolved: true,
      in_owned_asn: true,
      cert_org_match: true,
      not_wildcard: true,
    });
    expect(r.score).toBeLessThanOrEqual(100);
  });
});

describe('severity', () => {
  const mk = (t: NormalizedEntity['entity_type'], attrs = {}): NormalizedEntity => ({
    entity_type: t,
    identity: 'x',
    attributes: attrs,
    observed_at: new Date(0).toISOString(),
  });
  it('new subdomain = med', () => {
    expect(severityOf('ADDED', mk('subdomain'))).toBe('med');
  });
  it('new leak exposure = high', () => {
    expect(severityOf('ADDED', mk('exposure', { bucket: 'leaks' }))).toBe('high');
  });
  it('REMOVED = low', () => {
    expect(severityOf('REMOVED', mk('subdomain'))).toBe('low');
  });
  it('cert near expiry = med', () => {
    const soon = new Date(Date.now() + 5 * 86400000).toISOString();
    expect(severityOf('CHANGED', mk('cert', { not_after: soon }))).toBe('med');
  });
});
