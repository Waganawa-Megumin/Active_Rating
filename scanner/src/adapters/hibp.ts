// Active Rating — HaveIBeenPwned adapter (exposure/breach). Passive. Interface
// declared for Phase 3/4; fetch throws until implemented.

import type { EnrolledDomain, NormalizedEntity, Profile } from '@ar/shared';
import type { Adapter } from './types.js';
import { NotImplementedError } from '../errors.js';

export class HibpAdapter implements Adapter {
  readonly name = 'hibp';
  readonly requiresKey = true;
  readonly authoritative = false;
  supportsProfile(_p: Profile): boolean {
    return true;
  }
  async fetch(_domain: EnrolledDomain, _profile: Profile): Promise<NormalizedEntity[]> {
    throw new NotImplementedError(this.name);
  }
}
