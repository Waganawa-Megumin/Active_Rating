// Active Rating — IntelligenceX adapter (exposure/whois). Passive. Interface
// declared for Phase 4 (TI); fetch throws until implemented (design v0.1 §8).

import type { EnrolledDomain, NormalizedEntity, Profile } from '@ar/shared';
import type { Adapter } from './types.js';
import { NotImplementedError } from '../errors.js';

export class IntelxAdapter implements Adapter {
  readonly name = 'intelx';
  readonly requiresKey = true;
  readonly authoritative = false;
  supportsProfile(_p: Profile): boolean {
    return true; // read-only index query
  }
  async fetch(_domain: EnrolledDomain, _profile: Profile): Promise<NormalizedEntity[]> {
    throw new NotImplementedError(this.name);
  }
}
