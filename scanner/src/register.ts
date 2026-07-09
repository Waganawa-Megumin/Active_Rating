// Active Rating — GitOps registration CLI. Reads targets.yaml and upserts the
// organization tree + seed domains through the worker Admin API. Idempotent:
// orgs are matched by name, domains by (org, fqdn).
//
// Usage: tsx src/register.ts --file ../targets.yaml --api http://localhost:8787
// Env:   ADMIN_TOKEN (bearer) — required.

import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { RegistrationDocSchema, type RegistrationDoc } from '@ar/shared';

interface Args {
  file: string;
  api: string;
  prune: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { file: 'targets.yaml', api: 'http://localhost:8787', prune: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file') a.file = argv[++i];
    else if (argv[i] === '--api') a.api = argv[++i];
    else if (argv[i] === '--prune') a.prune = true;
  }
  return a;
}

async function postJson(url: string, token: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`POST ${url} -> HTTP ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

/** Delete orgs that are NOT declared in targets.yaml (GitOps reconcile). */
async function pruneUndeclared(apiBase: string, token: string, declaredNames: Set<string>) {
  const res = await fetch(`${apiBase}/api/organizations`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`prune: list orgs -> HTTP ${res.status}`);
  const orgs = (await res.json()) as Array<{ id: string; name: string }>;
  let removed = 0;
  for (const o of orgs) {
    if (declaredNames.has(o.name)) continue;
    const del = await fetch(`${apiBase}/admin/orgs/${encodeURIComponent(o.id)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    if (del.ok) {
      removed++;
      console.log(`[prune] removed ${o.name}`);
    } else {
      console.error(`[prune] failed to remove ${o.name}: HTTP ${del.status}`);
    }
  }
  console.log(`[prune] removed ${removed} undeclared organization(s)`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.ADMIN_TOKEN ?? '';
  if (!token) {
    console.error('ERROR: ADMIN_TOKEN is required');
    process.exit(2);
  }
  const apiBase = args.api.replace(/\/$/, '');

  const raw = await readFile(args.file, 'utf8');
  const doc: RegistrationDoc = RegistrationDocSchema.parse(parseYaml(raw));

  // Map declaration keys -> minted org ids (for parent resolution).
  const keyToId = new Map<string, string>();

  // First pass: orgs without parents resolved, then a second to wire parents.
  // Sort so parents (referenced by `parent`) are created before children when
  // possible; a simple two-pass handles arbitrary ordering.
  const pending = [...doc.organizations];
  let guard = pending.length * 2 + 1;
  while (pending.length && guard-- > 0) {
    const org = pending.shift()!;
    if (org.parent && !keyToId.has(org.parent)) {
      pending.push(org); // defer until parent is registered
      continue;
    }
    const parent_id = org.parent ? keyToId.get(org.parent)! : null;
    const resp = await postJson(`${apiBase}/admin/orgs`, token, {
      name: org.name,
      parent_id,
      relation_type: org.relation_type,
      active_confirmed: org.active_confirmed,
      slack_channel: org.slack_channel ?? null,
      notes: org.notes ?? null,
    });
    const id = String(resp.id);
    keyToId.set(org.key, id);
    console.log(
      `[org] ${org.name} (${org.relation_type}${org.active_confirmed ? ',active' : ''}) -> ${id}`,
    );

    for (const d of org.domains) {
      await postJson(`${apiBase}/admin/domains`, token, {
        org_id: id,
        fqdn: d.fqdn,
        enabled: d.enabled,
      });
      console.log(`   [domain] ${d.fqdn}`);
    }
  }
  if (pending.length) {
    console.error('ERROR: unresolved parent references for:', pending.map((p) => p.key));
    process.exit(1);
  }
  console.log(`[register] done — ${keyToId.size} organization(s)`);

  if (args.prune) {
    const declaredNames = new Set(doc.organizations.map((o) => o.name));
    await pruneUndeclared(apiBase, token, declaredNames);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
