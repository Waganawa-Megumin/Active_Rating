// Active Rating — offline fixtures adapter. Reads scanner/fixtures/<fqdn>.crtsh.json
// so the full scan→ingest→diff pipeline runs with no network (this sandbox, CI).
// Marked AUTHORITATIVE so it exercises the REMOVED path deterministically.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  NormalizedEntitySchema,
  normalizeAttributes,
  type EnrolledDomain,
  type NormalizedEntity,
  type Profile,
} from '@ar/shared';
import type { Adapter } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// src/adapters -> ../../fixtures (works in tsx source layout)
const FIXTURE_DIR = join(HERE, '..', '..', 'fixtures');

export class OfflineAdapter implements Adapter {
  readonly name = 'offline';
  readonly requiresKey = false;
  readonly authoritative = true;

  supportsProfile(_p: Profile): boolean {
    return true;
  }

  async fetch(domain: EnrolledDomain, _profile: Profile): Promise<NormalizedEntity[]> {
    const path = join(FIXTURE_DIR, `${domain.fqdn}.crtsh.json`);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      // No fixture for this domain -> nothing observed (avoids spurious REMOVED
      // by simply having no entities; caller treats offline as authoritative but
      // an empty authoritative set with no prior assets is a no-op).
      return [];
    }
    const parsed = JSON.parse(raw) as unknown[];
    const out: NormalizedEntity[] = [];
    for (const item of parsed) {
      const rec = item as NormalizedEntity;
      // Re-normalize attributes defensively so fixtures match engine expectations.
      const normalized: NormalizedEntity = {
        ...rec,
        attributes: await normalizeAttributes(rec.attributes ?? {}),
        observed_at: rec.observed_at ?? new Date().toISOString(),
      };
      const check = NormalizedEntitySchema.safeParse(normalized);
      if (check.success) out.push(check.data as NormalizedEntity);
    }
    return out;
  }
}
