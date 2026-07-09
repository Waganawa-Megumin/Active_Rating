// Active Rating — scanner orchestrator CLI (design v1.0 §8 orchestrator).
// Walks enrolled domains, picks profile by ownership, runs the profile-legal
// adapters, and POSTs signed snapshots to the worker /ingest.
//
// Env:
//   INGEST_HMAC_SECRET  (required unless --dry-run)  shared signing secret
//   AR_INGEST_URL       ingest endpoint (default http://localhost:8787/ingest)
//   AR_API_BASE         API base for enrollment (default: derived from AR_INGEST_URL)
//   OFFLINE=1           use fixtures instead of live adapters (or pass --offline)
//
// Flags: --offline  --org <substr>  --domain <substr>  --dry-run

import type { NormalizedEntity } from '@ar/shared';
import {
  buildPayload,
  postIngest,
} from './ingestClient.js';
import { loadEnrollment } from './orgtree.js';
import { profileFor, assertAllowed } from './profile.js';
import { getAdapters } from './adapters/registry.js';

type MergeBucket = Map<string, { e: NormalizedEntity; sources: Set<string> }>;

/** Merge one entity into the per-domain bucket, tracking distinct sources. */
function mergeEntity(byKey: MergeBucket, e: NormalizedEntity, source: string): void {
  const key = `${e.entity_type}\x1f${e.identity}`;
  const cur = byKey.get(key);
  if (!cur) {
    byKey.set(key, {
      e: { ...e, attributes: { ...e.attributes }, signals: { ...(e.signals ?? {}) } },
      sources: new Set([source]),
    });
    return;
  }
  cur.sources.add(source);
  // fill missing attributes; keep first-seen values
  cur.e.attributes = { ...e.attributes, ...cur.e.attributes };
  const s = cur.e.signals ?? {};
  const es = e.signals ?? {};
  cur.e.signals = {
    ...s,
    active_resolved: Boolean(s.active_resolved || es.active_resolved),
    in_owned_asn: Boolean(s.in_owned_asn || es.in_owned_asn),
    not_wildcard: Boolean(s.not_wildcard || es.not_wildcard),
    cert_org_match: Boolean(s.cert_org_match || es.cert_org_match),
  };
  if (e.observed_at > cur.e.observed_at) cur.e.observed_at = e.observed_at;
}

/** Finalize merged entities, setting source_count = number of distinct sources. */
function finalizeMerge(byKey: MergeBucket): NormalizedEntity[] {
  const out: NormalizedEntity[] = [];
  for (const { e, sources } of byKey.values()) {
    e.signals = { ...(e.signals ?? {}), source_count: sources.size };
    out.push(e);
  }
  return out;
}

interface Args {
  offline: boolean;
  org?: string;
  domain?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { offline: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--offline') a.offline = true;
    else if (t === '--dry-run') a.dryRun = true;
    else if (t === '--org') a.org = argv[++i];
    else if (t === '--domain') a.domain = argv[++i];
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const offline = args.offline || process.env.OFFLINE === '1';
  const ingestUrl = process.env.AR_INGEST_URL ?? 'http://localhost:8787/ingest';
  const apiBase =
    process.env.AR_API_BASE ?? ingestUrl.replace(/\/ingest\/?$/, '');
  const secret = process.env.INGEST_HMAC_SECRET ?? '';

  if (!args.dryRun && !secret) {
    console.error('ERROR: INGEST_HMAC_SECRET is required (or pass --dry-run)');
    process.exit(2);
  }

  const apiToken = process.env.AR_API_TOKEN ?? process.env.ADMIN_TOKEN ?? '';
  console.log(`[scan] mode=${offline ? 'offline' : 'live'} api=${apiBase}`);
  const enrollment = await loadEnrollment(apiBase, apiToken);
  const targets = enrollment.filter(
    (d) =>
      (!args.org || d.organization_id.includes(args.org)) &&
      (!args.domain || d.fqdn.includes(args.domain)),
  );
  console.log(`[scan] ${targets.length}/${enrollment.length} target domain(s)`);

  let totalAdded = 0,
    totalChanged = 0,
    totalRemoved = 0,
    failures = 0, // hard failures: domain yielded nothing, or ingest failed
    sourceWarnings = 0; // soft: a single source failed but others carried the domain

  for (const domain of targets) {
    const profile = profileFor(domain.relation_type, domain.active_confirmed);
    const adapters = getAdapters(profile, { offline });

    // Run every profile-legal source, then MERGE by identity so multi-source
    // corroboration raises confidence (design v0.2 §B). One snapshot per domain.
    const collected: Array<{ name: string; authoritative: boolean }> = [];
    let merged: NormalizedEntity[] = [];
    const byKey = new Map<string, { e: NormalizedEntity; sources: Set<string> }>();

    for (const adapter of adapters) {
      try {
        assertAllowed(adapter, profile); // code-level active-scan guard
        const entities = await adapter.fetch(domain, profile);
        collected.push({ name: adapter.name, authoritative: adapter.authoritative });
        for (const e of entities) mergeEntity(byKey, e, adapter.name);
      } catch (err) {
        // A flaky passive corroboration source (e.g. crt.sh 503) must not red the
        // whole scan — warn and let the other sources carry the domain.
        sourceWarnings++;
        console.error(`[warn] ${domain.fqdn} via ${adapter.name}:`, (err as Error).message);
      }
    }
    if (collected.length === 0) {
      // Every source for this domain failed — nothing to ingest. Hard failure.
      if (adapters.length > 0) {
        failures++;
        console.error(`[fail] ${domain.fqdn}: all ${adapters.length} source(s) failed`);
      }
      continue;
    }

    merged = finalizeMerge(byKey);
    const sources = collected.map((c) => c.name);
    // Authoritative (drives REMOVED) only when a single authoritative source ran
    // (e.g. offline fixtures); merged passive sources are additive.
    const authoritative = collected.length === 1 && collected[0]!.authoritative;

    if (args.dryRun) {
      console.log(`[dry-run] ${domain.fqdn} via ${sources.join('+')} (${profile}) — ${merged.length} merged entities`);
      continue;
    }

    try {
      const payload = buildPayload({ domain, adapter: sources.join('+'), authoritative, profile, entities: merged });
      const result = await postIngest({ ingestUrl, secret, payload });
      if (result.ok && typeof result.body === 'object' && result.body) {
        const b = result.body as Record<string, number>;
        totalAdded += b.added ?? 0;
        totalChanged += b.changed ?? 0;
        totalRemoved += b.removed ?? 0;
        console.log(
          `[ok] ${domain.fqdn} via ${sources.join('+')} (${profile}) — ${merged.length} assets · +${b.added ?? 0} ~${b.changed ?? 0} -${b.removed ?? 0} =${b.unchanged ?? 0}`,
        );
      } else {
        failures++;
        console.error(`[fail] ${domain.fqdn}: HTTP ${result.status}`, result.body);
      }
    } catch (err) {
      failures++;
      console.error(`[error] ${domain.fqdn} ingest:`, (err as Error).message);
    }
  }

  console.log(
    `[scan] done — total +${totalAdded} ~${totalChanged} -${totalRemoved}, ` +
      `${failures} failure(s), ${sourceWarnings} source warning(s)`,
  );
  // Only hard failures (a domain that produced no snapshot, or a failed ingest)
  // are fatal. Transient single-source outages are warnings — the run stays green.
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
