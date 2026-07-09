// Active Rating — email authentication adapter (design v0.5 §E-1). Passive DNS
// lookups (no key): SPF / DMARC / MTA-STS at the domain apex. Emits one `email`
// entity per domain; findings are derived downstream (weak/missing DMARC etc.).

import { resolveTxt } from 'node:dns/promises';
import {
  identityOf,
  normalizeAttributes,
  type EnrolledDomain,
  type NormalizedEntity,
  type Profile,
} from '@ar/shared';
import type { Adapter } from './types.js';

async function txt(name: string): Promise<string[]> {
  try {
    const rows = await resolveTxt(name);
    return rows.map((chunks) => chunks.join(''));
  } catch {
    return []; // NXDOMAIN / ENODATA => no record
  }
}

function spfPolicy(records: string[]): string | null {
  const spf = records.find((r) => /^v=spf1\b/i.test(r.trim()));
  if (!spf) return null;
  if (/[-]all\b/.test(spf)) return 'strict';
  if (/~all\b/.test(spf)) return 'soft';
  if (/\?all\b/.test(spf)) return 'neutral';
  if (/\+all\b/.test(spf)) return 'none';
  return 'neutral';
}

function dmarcPolicy(records: string[]): string | null {
  const dmarc = records.find((r) => /^v=DMARC1\b/i.test(r.trim()));
  if (!dmarc) return null;
  const m = /\bp=\s*(none|quarantine|reject)\b/i.exec(dmarc);
  return m ? m[1]!.toLowerCase() : 'none';
}

export class EmailAuthAdapter implements Adapter {
  readonly name = 'email-auth';
  readonly requiresKey = false;
  readonly authoritative = false;

  supportsProfile(_p: Profile): boolean {
    return true; // read-only DNS
  }

  async fetch(domain: EnrolledDomain, _profile: Profile): Promise<NormalizedEntity[]> {
    const apex = domain.fqdn;
    const [spfRecs, dmarcRecs, mtaStsRecs] = await Promise.all([
      txt(apex),
      txt(`_dmarc.${apex}`),
      txt(`_mta-sts.${apex}`),
    ]);

    const spf = spfPolicy(spfRecs);
    const dmarc = dmarcPolicy(dmarcRecs);
    const mta_sts = mtaStsRecs.some((r) => /^v=STSv1\b/i.test(r.trim()));

    const identity = identityOf('email', { domain: apex });
    return [
      {
        entity_type: 'email',
        identity,
        attributes: await normalizeAttributes({ domain: apex, spf, dmarc, mta_sts }),
        observed_at: new Date().toISOString(),
        signals: { source_count: 1, active_resolved: true, not_wildcard: true },
      },
    ];
  }
}
