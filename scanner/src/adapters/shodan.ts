// Active Rating — Shodan adapter (service). Passive query only (no enumeration).
// Interface declared for Phase 4; fetch throws until implemented.

import type { EnrolledDomain, NormalizedEntity, Profile } from '@ar/shared';
import type { Adapter } from './types.js';
import { NotImplementedError } from '../errors.js';

export class ShodanAdapter implements Adapter {
  readonly name = 'shodan';
  readonly requiresKey = true;
  readonly authoritative = false;
  supportsProfile(_p: Profile): boolean {
    return true; // existing-index query only
  }
  async fetch(_domain: EnrolledDomain, _profile: Profile): Promise<NormalizedEntity[]> {
    throw new NotImplementedError(this.name);
  }
}
