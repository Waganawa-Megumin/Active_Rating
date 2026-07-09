// Regression: a large multi-entity ingest (crt.sh-sized: many subdomains +
// certs) must ingest correctly through the chunked D1 batch path. Guards against
// the prod-only D1 batch-size limit that a single-asset payload never exercised.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { signRequest, canonicalHost, INGEST_SCHEMA_VERSION, type IngestPayload } from '@ar/shared';
import { app } from '../src/index.js';
import { FakeD1, fakeR2 } from './support/d1.js';
import type { Bindings } from '../src/env.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(HERE, '..', 'schema.sql'), 'utf8');
const SECRET = 'integration-secret';
const ADMIN = 'integration-admin';
let env: Bindings;
let rawDb: Database.Database;

beforeEach(() => {
  rawDb = new Database(':memory:');
  rawDb.exec(SCHEMA);
  env = {
    DB: new FakeD1(rawDb) as unknown as D1Database,
    EVIDENCE: fakeR2,
    OFFLINE: '1',
    SLACK_ENABLED: '0',
    INGEST_HMAC_SECRET: SECRET,
    ADMIN_TOKEN: ADMIN,
  } as Bindings;
});

async function signedIngest(payload: IngestPayload): Promise<Request> {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const headers = await signRequest({ secret: SECRET, method: 'POST', path: '/ingest', bodyBytes: body });
  return new Request('http://localhost/ingest', { method: 'POST', headers, body });
}

describe('large ingest (chunked D1 batch)', () => {
  it('ingests ~40 subdomains + ~200 certs through the chunked batch path', async () => {
    const admin = { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' };
    const orgRes = await app.fetch(
      new Request('http://localhost/admin/orgs', {
        method: 'POST', headers: admin,
        body: JSON.stringify({ name: 'NEC Corporation', relation_type: 'self', active_confirmed: true }),
      }), env);
    const org = (await orgRes.json()) as { id: string };
    const domRes = await app.fetch(
      new Request('http://localhost/admin/domains', {
        method: 'POST', headers: admin,
        body: JSON.stringify({ org_id: org.id, fqdn: 'nec.com' }),
      }), env);
    const dom = (await domRes.json()) as { id: string };

    const entities: IngestPayload['entities'] = [];
    for (let i = 0; i < 40; i++) {
      entities.push({
        entity_type: 'subdomain',
        identity: canonicalHost(`host${i}.nec.com`),
        attributes: { resolves: true, source: 'ct' },
        observed_at: '2026-07-09T00:00:00.000Z',
        signals: { source_count: 1, not_wildcard: true },
      });
    }
    for (let i = 0; i < 200; i++) {
      entities.push({
        entity_type: 'cert',
        identity: `cert:${i.toString(16).padStart(8, '0')}`,
        attributes: { issuer: 'C=US, O=DigiCert Inc', not_after: '2026-12-31T00:00:00Z' },
        observed_at: '2026-07-09T00:00:00.000Z',
        signals: { source_count: 1, not_wildcard: true },
      });
    }
    const payload: IngestPayload = {
      schema_version: INGEST_SCHEMA_VERSION,
      domain_id: dom.id,
      organization_id: org.id,
      source: { adapter: 'crt.sh+anubis+email-auth', is_authoritative: false, profile: 'active' },
      run_at: '2026-07-09T00:00:00.000Z',
      run_id: 'run-big',
      entities,
    };
    const res = await app.fetch(await signedIngest(payload), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; added: number };
    expect(body.ok).toBe(true);
    expect(body.added).toBe(240);

    // rating aggregate is computed from the 240 assets
    const rating = (await (
      await app.fetch(
        new Request(`http://localhost/api/rating/${org.id}`, { headers: { authorization: `Bearer ${ADMIN}` } }),
        env,
      )
    ).json()) as { assets: { total: number } };
    expect(rating.assets.total).toBe(240);
  });
});
