// Active Rating — crt.sh (Certificate Transparency) adapter. Free, no key,
// read-only (passive) — safe under both profiles. NOT authoritative (CT is
// additive), so it never drives REMOVED.

import {
  canonicalHost,
  identityOf,
  normalizeAttributes,
  type EnrolledDomain,
  type NormalizedEntity,
  type Profile,
} from '@ar/shared';
import type { Adapter } from './types.js';

interface CrtShRow {
  name_value?: string;
  common_name?: string;
  serial_number?: string;
  issuer_name?: string;
  not_before?: string;
  not_after?: string;
}

export class CrtShAdapter implements Adapter {
  readonly name = 'crt.sh';
  readonly requiresKey = false;
  readonly authoritative = false;

  supportsProfile(_p: Profile): boolean {
    return true; // CT lookups are read-only
  }

  async fetch(domain: EnrolledDomain, _profile: Profile): Promise<NormalizedEntity[]> {
    const url = `https://crt.sh/?q=${encodeURIComponent('%.' + domain.fqdn)}&output=json`;
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'active-rating/0.1 (+ASM)' },
    });
    if (!res.ok) throw new Error(`crt.sh HTTP ${res.status}`);
    const rows = (await res.json()) as CrtShRow[];

    const observedAt = new Date().toISOString();
    const subdomains = new Map<string, NormalizedEntity>();
    const certs: NormalizedEntity[] = [];

    for (const row of rows) {
      // name_value may contain several FQDNs separated by newlines.
      const names = (row.name_value ?? row.common_name ?? '')
        .split(/\s+/)
        .map((n) => canonicalHost(n))
        .filter((n) => n && !n.startsWith('*.') && n.endsWith(domain.fqdn));

      for (const fqdn of names) {
        if (subdomains.has(fqdn)) continue;
        const identity = identityOf('subdomain', { fqdn });
        subdomains.set(fqdn, {
          entity_type: 'subdomain',
          identity,
          attributes: await normalizeAttributes({ source: 'ct', via_cert: row.serial_number ?? null }),
          observed_at: observedAt,
          signals: { source_count: 1, not_wildcard: true },
        });
      }

      if (row.serial_number) {
        const identity = identityOf('cert', { sha256: String(row.serial_number).toLowerCase() });
        certs.push({
          entity_type: 'cert',
          identity,
          attributes: await normalizeAttributes({
            issuer: row.issuer_name ?? null,
            not_before: row.not_before ?? null,
            not_after: row.not_after ?? null,
            common_name: row.common_name ?? null,
          }),
          observed_at: observedAt,
          signals: { source_count: 1, not_wildcard: true },
        });
      }
    }

    return [...subdomains.values(), ...certs];
  }
}
