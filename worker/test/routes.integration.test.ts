// Workerd-free HTTP integration test: drives the REAL Hono app in-process via
// app.fetch(), covering HMAC-signed /ingest, admin auth on /admin/*, /dispute,
// and the read /api/*. Uses the SQLite D1 shim.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  signRequest,
  canonicalHost,
  INGEST_SCHEMA_VERSION,
  type IngestPayload,
} from '@ar/shared';
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
  };
});

function req(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

// Authenticated GET for the admin-gated /api/* routes.
function apiReq(path: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: { authorization: `Bearer ${ADMIN}` },
  });
}

async function signedIngest(payload: IngestPayload): Promise<Request> {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const headers = await signRequest({ secret: SECRET, method: 'POST', path: '/ingest', bodyBytes: body });
  return req('/ingest', { method: 'POST', headers, body });
}

describe('HTTP routes (real Hono app, in-process)', () => {
  it('registers org+domain via admin API (auth enforced), then ingests', async () => {
    // no token -> 401
    const noAuth = await app.fetch(
      req('/admin/orgs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
      env,
    );
    expect(noAuth.status).toBe(401);

    // register org
    const orgRes = await app.fetch(
      req('/admin/orgs', {
        method: 'POST',
        headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'ACME', relation_type: 'self', active_confirmed: true }),
      }),
      env,
    );
    expect(orgRes.status).toBe(200);
    const org = (await orgRes.json()) as { id: string };

    // register domain
    const domRes = await app.fetch(
      req('/admin/domains', {
        method: 'POST',
        headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ org_id: org.id, fqdn: 'example.com' }),
      }),
      env,
    );
    expect(domRes.status).toBe(200);
    const dom = (await domRes.json()) as { id: string };

    // /api/* is admin-gated: no token -> 401
    const noAuthApi = await app.fetch(req('/api/enrollment'), env);
    expect(noAuthApi.status).toBe(401);

    // enrollment feed reflects the registration (with token)
    const enr = (await (await app.fetch(apiReq('/api/enrollment'), env)).json()) as unknown[];
    expect(enr.length).toBe(1);

    // signed ingest with one subdomain -> ADDED
    const payload: IngestPayload = {
      schema_version: INGEST_SCHEMA_VERSION,
      domain_id: dom.id,
      organization_id: org.id,
      source: { adapter: 'offline', is_authoritative: true, profile: 'active' },
      run_at: '2026-07-08T00:00:00.000Z',
      run_id: 'run-1',
      entities: [
        {
          entity_type: 'subdomain',
          identity: canonicalHost('api.example.com'),
          attributes: { resolves: true, a: ['203.0.113.20'] },
          observed_at: '2026-07-08T00:00:00.000Z',
          signals: { source_count: 2, active_resolved: true, not_wildcard: true },
        },
      ],
    };
    const ingestRes = await app.fetch(await signedIngest(payload), env);
    expect(ingestRes.status).toBe(200);
    const body = (await ingestRes.json()) as { added: number };
    expect(body.added).toBe(1);

    // rating aggregate is available
    const rating = (await (await app.fetch(apiReq(`/api/rating/${org.id}`), env)).json()) as {
      score: number;
      assets: { total: number };
    };
    expect(rating.assets.total).toBe(1);
    expect(rating.score).toBeGreaterThan(0);
  });

  it('rejects an ingest with a bad signature (401)', async () => {
    const payload: IngestPayload = {
      schema_version: INGEST_SCHEMA_VERSION,
      domain_id: 'x',
      organization_id: 'y',
      source: { adapter: 'offline', is_authoritative: true, profile: 'active' },
      run_at: '2026-07-08T00:00:00.000Z',
      run_id: 'r',
      entities: [],
    };
    const body = new TextEncoder().encode(JSON.stringify(payload));
    const headers = await signRequest({ secret: 'WRONG', method: 'POST', path: '/ingest', bodyBytes: body });
    const res = await app.fetch(req('/ingest', { method: 'POST', headers, body }), env);
    expect(res.status).toBe(401);
  });

  it('handles a dispute and revalidates against evidence', async () => {
    // register + ingest to create an asset with evidence
    const org = (await (
      await app.fetch(
        req('/admin/orgs', {
          method: 'POST',
          headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'ACME', relation_type: 'self', active_confirmed: true }),
        }),
        env,
      )
    ).json()) as { id: string };
    const dom = (await (
      await app.fetch(
        req('/admin/domains', {
          method: 'POST',
          headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' },
          body: JSON.stringify({ org_id: org.id, fqdn: 'example.com' }),
        }),
        env,
      )
    ).json()) as { id: string };

    const identity = canonicalHost('api.example.com');
    const payload: IngestPayload = {
      schema_version: INGEST_SCHEMA_VERSION,
      domain_id: dom.id,
      organization_id: org.id,
      source: { adapter: 'offline', is_authoritative: true, profile: 'active' },
      run_at: '2026-07-08T00:00:00.000Z',
      run_id: 'run-1',
      entities: [
        { entity_type: 'subdomain', identity, attributes: { resolves: true }, observed_at: '2026-07-08T00:00:00.000Z', signals: { source_count: 2 } },
      ],
    };
    await app.fetch(await signedIngest(payload), env);

    const assetId = (rawDb.prepare('SELECT id FROM assets LIMIT 1').get() as { id: string }).id;
    const res = await app.fetch(
      req('/dispute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ asset_id: assetId, claim: 'これは当社の資産ではない' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const out = (await res.json()) as { outcome: string; evidence_count: number };
    // evidence has no TTL -> still valid -> upheld
    expect(out.outcome).toBe('upheld');
    expect(out.evidence_count).toBeGreaterThan(0);
  });
});
