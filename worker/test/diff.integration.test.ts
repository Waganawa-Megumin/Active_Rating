// Workerd-free integration test: runs the REAL diff engine + queries against a
// real SQLite database (the actual schema.sql), covering ADDED/CHANGED/REMOVED,
// debounce, confidence/state, and evidence-bundle creation.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  assetIdOf,
  canonicalJson,
  canonicalHost,
  INGEST_SCHEMA_VERSION,
  type IngestPayload,
  type NormalizedEntity,
} from '@ar/shared';
import { runDiff } from '../src/diff/engine.js';
import { recentChanges, listAssets, getAsset } from '../src/db/queries.js';
import { FakeD1, fakeR2 } from './support/d1.js';
import type { Bindings } from '../src/env.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(HERE, '..', 'schema.sql'), 'utf8');

const DOM = 'dom-test';
const ORG = 'org-test';
const NOW0 = '2026-07-01T00:00:00.000Z';
const NOW1 = '2026-07-08T00:00:00.000Z';

function sub(fqdn: string, attrs: Record<string, unknown>, signals?: NormalizedEntity['signals']): NormalizedEntity {
  return {
    entity_type: 'subdomain',
    identity: canonicalHost(fqdn),
    attributes: attrs,
    observed_at: NOW1,
    signals,
  };
}

async function seedBaseline(db: Database.Database) {
  db.prepare(
    `INSERT INTO organizations (id,name,relation_type,active_confirmed,created_at) VALUES (?1,?2,'self',1,?3)`,
  ).run({ 1: ORG, 2: 'Test Org', 3: NOW0 });
  db.prepare(`INSERT INTO domains (id,org_id,fqdn,enabled,created_at) VALUES (?1,?2,?3,1,?4)`).run({
    1: DOM,
    2: ORG,
    3: 'example.com',
    4: NOW0,
  });
  // two baseline subdomain assets: www (will stay), old (will be removed)
  for (const [fqdn, attrs] of [
    ['www.example.com', { resolves: true, a: ['203.0.113.10'] }],
    ['old.example.com', { resolves: true, a: ['203.0.113.99'] }],
  ] as const) {
    const identity = canonicalHost(fqdn);
    const id = await assetIdOf(DOM, 'subdomain', identity);
    db.prepare(
      `INSERT INTO assets (id,domain_id,org_id,entity_type,identity,attrs_json,confidence,state,attribution_conf,source_count,stable_runs,first_seen,last_seen,status)
       VALUES (?1,?2,?3,'subdomain',?4,?5,60,'confirmed','med',2,1,?6,?6,'active')`,
    ).run({ 1: id, 2: DOM, 3: ORG, 4: identity, 5: canonicalJson(attrs), 6: NOW0 });
  }
}

function payload(entities: NormalizedEntity[], authoritative: boolean): IngestPayload {
  return {
    schema_version: INGEST_SCHEMA_VERSION,
    domain_id: DOM,
    organization_id: ORG,
    source: { adapter: 'offline', is_authoritative: authoritative, profile: 'active' },
    run_at: NOW1,
    run_id: `run-${Math.floor(Math.random() * 1e9)}`,
    entities,
  };
}

let env: Bindings;
let rawDb: Database.Database;

beforeEach(async () => {
  rawDb = new Database(':memory:');
  rawDb.exec(SCHEMA);
  await seedBaseline(rawDb);
  env = {
    DB: new FakeD1(rawDb) as unknown as D1Database,
    EVIDENCE: fakeR2,
    OFFLINE: '1',
    SLACK_ENABLED: '0',
    INGEST_HMAC_SECRET: 'x',
    ADMIN_TOKEN: 'x',
  };
});

describe('diff engine (real schema, real SQLite)', () => {
  it('emits ADDED / CHANGED / REMOVED and debounces unchanged', async () => {
    // www unchanged, api NEW, old dropped -> REMOVED (authoritative)
    const p = payload(
      [
        sub('www.example.com', { resolves: true, a: ['203.0.113.10'] }, { source_count: 2, active_resolved: true, not_wildcard: true }),
        sub('api.example.com', { resolves: true, a: ['203.0.113.20'] }, { source_count: 1, active_resolved: true, not_wildcard: true }),
      ],
      true,
    );
    const summary = await runDiff(env, p, { org_id: ORG });
    expect(summary.added).toBe(1);
    expect(summary.removed).toBe(1);
    expect(summary.unchanged).toBe(1);
    expect(summary.changed).toBe(0);

    const changes = await recentChanges(env.DB as unknown as D1Database, 100);
    const byType = changes.reduce<Record<string, number>>((a, c) => ((a[c.change_type] = (a[c.change_type] ?? 0) + 1), a), {});
    expect(byType).toEqual({ ADDED: 1, REMOVED: 1 });

    // evidence bundle created for the ADDED change
    const ev = rawDb.prepare('SELECT COUNT(*) c FROM evidence_bundles').get() as { c: number };
    expect(ev.c).toBe(1);

    // debounce: www stable_runs incremented
    const wwwId = await assetIdOf(DOM, 'subdomain', 'www.example.com');
    const www = await getAsset(env.DB as unknown as D1Database, wwwId);
    expect(www?.stable_runs).toBe(2);

    // old marked gone
    const oldId = await assetIdOf(DOM, 'subdomain', 'old.example.com');
    const old = await getAsset(env.DB as unknown as D1Database, oldId);
    expect(old?.status).toBe('gone');

    // api confirmed via active_resolved
    const apiId = await assetIdOf(DOM, 'subdomain', 'api.example.com');
    const api = await getAsset(env.DB as unknown as D1Database, apiId);
    expect(api?.state).toBe('confirmed');
  });

  it('detects a CHANGED attribute', async () => {
    const p = payload(
      [sub('www.example.com', { resolves: true, a: ['203.0.113.11'] }, { source_count: 2 })],
      false, // non-authoritative: no REMOVED for the missing old.example.com
    );
    const summary = await runDiff(env, p, { org_id: ORG });
    expect(summary.changed).toBe(1);
    expect(summary.removed).toBe(0);
    const assets = await listAssets(env.DB as unknown as D1Database, 100);
    const www = assets.find((a) => a.identity === 'www.example.com');
    expect(JSON.parse(www!.attrs_json).a).toEqual(['203.0.113.11']);
  });

  it('is a no-op on a re-run with identical input (pure debounce)', async () => {
    const entities = [sub('www.example.com', { resolves: true, a: ['203.0.113.10'] }, { source_count: 2 })];
    await runDiff(env, payload(entities, false), { org_id: ORG });
    const before = (rawDb.prepare('SELECT COUNT(*) c FROM changes').get() as { c: number }).c;
    await runDiff(env, payload(entities, false), { org_id: ORG });
    const after = (rawDb.prepare('SELECT COUNT(*) c FROM changes').get() as { c: number }).c;
    expect(after).toBe(before); // no new changes emitted
  });
});
