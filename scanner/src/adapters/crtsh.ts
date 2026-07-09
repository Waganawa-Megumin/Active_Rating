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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * crt.sh is chronically flaky (503/502/504/429, HTML error pages, slow tail).
 * Retry transient failures with exponential backoff + jitter and a per-attempt
 * timeout so one bad response never reds an otherwise-good scan. Throws only if
 * every attempt fails — the caller treats that as a non-fatal source warning.
 */
async function fetchCrtShRows(url: string, attempts = 4): Promise<CrtShRow[]> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 45_000);
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'active-rating/0.1 (+ASM)' },
        signal: ctl.signal,
      });
      if (!res.ok) {
        // 4xx (except 429) are permanent — don't waste retries.
        if (res.status < 500 && res.status !== 429) throw new Error(`crt.sh HTTP ${res.status}`);
        throw new Error(`crt.sh HTTP ${res.status} (transient)`);
      }
      const text = await res.text();
      try {
        return JSON.parse(text) as CrtShRow[];
      } catch {
        throw new Error('crt.sh returned non-JSON (transient error page)');
      }
    } catch (err) {
      lastErr = err;
      const permanent = err instanceof Error && /HTTP 4\d\d(?! \(transient\))/.test(err.message);
      if (permanent || i === attempts - 1) break;
      // backoff: 1s, 2s, 4s (+ up to 500ms jitter)
      await sleep(2 ** i * 1000 + Math.floor(Math.random() * 500));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('crt.sh fetch failed');
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
    const rows = await fetchCrtShRows(url);

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
