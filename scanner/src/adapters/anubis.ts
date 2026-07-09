// Active Rating — Anubis-DB subdomain adapter (jldc.me). Free, no key, passive.
// A second independent discovery source so assets corroborated by ≥2 sources are
// promoted to `confirmed` (design v0.2 §B multi-source confidence).

import {
  canonicalHost,
  identityOf,
  normalizeAttributes,
  type EnrolledDomain,
  type NormalizedEntity,
  type Profile,
} from '@ar/shared';
import type { Adapter } from './types.js';

export class AnubisAdapter implements Adapter {
  readonly name = 'anubis';
  readonly requiresKey = false;
  readonly authoritative = false;

  supportsProfile(_p: Profile): boolean {
    return true; // read-only public dataset
  }

  async fetch(domain: EnrolledDomain, _profile: Profile): Promise<NormalizedEntity[]> {
    const url = `https://jldc.me/anubis/subdomains/${encodeURIComponent(domain.fqdn)}`;
    let names: string[] = [];
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'active-rating/0.1 (+ASM)' },
      });
      if (!res.ok) return []; // 404 = no data; never fail the scan
      names = (await res.json()) as string[];
    } catch {
      return [];
    }

    const observedAt = new Date().toISOString();
    const out: NormalizedEntity[] = [];
    const seen = new Set<string>();
    for (const raw of names) {
      const fqdn = canonicalHost(String(raw));
      if (!fqdn || !fqdn.endsWith(domain.fqdn) || seen.has(fqdn)) continue;
      seen.add(fqdn);
      out.push({
        entity_type: 'subdomain',
        identity: identityOf('subdomain', { fqdn }),
        attributes: await normalizeAttributes({ source: 'anubis' }),
        observed_at: observedAt,
        signals: { source_count: 1, not_wildcard: true },
      });
    }
    return out;
  }
}
