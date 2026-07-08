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

import {
  buildPayload,
  postIngest,
} from './ingestClient.js';
import { loadEnrollment } from './orgtree.js';
import { profileFor, assertAllowed } from './profile.js';
import { getAdapters } from './adapters/registry.js';

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
    failures = 0;

  for (const domain of targets) {
    const profile = profileFor(domain.relation_type, domain.active_confirmed);
    const adapters = getAdapters(profile, { offline });

    for (const adapter of adapters) {
      try {
        assertAllowed(adapter, profile); // code-level active-scan guard
        const entities = await adapter.fetch(domain, profile);
        const payload = buildPayload({
          domain,
          adapter: adapter.name,
          authoritative: adapter.authoritative,
          profile,
          entities,
        });

        if (args.dryRun) {
          console.log(
            `[dry-run] ${domain.fqdn} via ${adapter.name} (${profile}) — ${entities.length} entities`,
          );
          continue;
        }

        const result = await postIngest({ ingestUrl, secret, payload });
        if (result.ok && typeof result.body === 'object' && result.body) {
          const b = result.body as Record<string, number>;
          totalAdded += b.added ?? 0;
          totalChanged += b.changed ?? 0;
          totalRemoved += b.removed ?? 0;
          console.log(
            `[ok] ${domain.fqdn} via ${adapter.name} (${profile}) — +${b.added ?? 0} ~${b.changed ?? 0} -${b.removed ?? 0} =${b.unchanged ?? 0}`,
          );
        } else {
          failures++;
          console.error(`[fail] ${domain.fqdn} via ${adapter.name}: HTTP ${result.status}`, result.body);
        }
      } catch (err) {
        failures++;
        console.error(`[error] ${domain.fqdn} via ${adapter.name}:`, (err as Error).message);
      }
    }
  }

  console.log(
    `[scan] done — total +${totalAdded} ~${totalChanged} -${totalRemoved}, ${failures} failure(s)`,
  );
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
