import { describe, expect, it } from 'vitest';
import { IngestPayloadSchema, type EnrolledDomain } from '@ar/shared';
import { OfflineAdapter } from '../src/adapters/offline.js';
import { buildPayload } from '../src/ingestClient.js';

const domain: EnrolledDomain = {
  domain_id: 'dom-example',
  organization_id: 'org-acme',
  fqdn: 'example.com',
  relation_type: 'self',
  active_confirmed: true,
};

describe('offline adapter + payload', () => {
  it('reads the generated fixture and yields valid entities', async () => {
    const entities = await new OfflineAdapter().fetch(domain, 'active');
    expect(entities.length).toBeGreaterThan(0);
    expect(entities.every((e) => e.entity_type === 'subdomain')).toBe(true);
    expect(entities.some((e) => e.identity === 'staging.example.com')).toBe(true);
  });

  it('builds a schema-valid ingest payload', async () => {
    const adapter = new OfflineAdapter();
    const entities = await adapter.fetch(domain, 'active');
    const payload = buildPayload({
      domain,
      adapter: adapter.name,
      authoritative: adapter.authoritative,
      profile: 'active',
      entities,
    });
    expect(() => IngestPayloadSchema.parse(payload)).not.toThrow();
    expect(payload.source.is_authoritative).toBe(true);
    expect(payload.domain_id).toBe('dom-example');
  });

  it('returns [] for a domain with no fixture (no spurious data)', async () => {
    const entities = await new OfflineAdapter().fetch(
      { ...domain, fqdn: 'no-fixture.example', domain_id: 'd2' },
      'active',
    );
    expect(entities).toEqual([]);
  });
});
