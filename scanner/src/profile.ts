// Active Rating — scan profile gating (design v1.0 §3, v0.1 §3).
// relation_type + active_confirmed decide active vs passive. Active-only
// techniques are forbidden under passive at the code level.

import type { Profile, RelationType } from '@ar/shared';
import { ForbiddenProfileError } from './errors.js';
import type { Adapter } from './adapters/types.js';

/**
 * Decide the scan profile. self/subsidiary require active_confirmed to earn
 * 'active'; everything else (supplier/partner/watch, or unconfirmed ownership)
 * falls back to 'passive'.
 */
export function profileFor(relation_type: RelationType, active_confirmed: boolean): Profile {
  if ((relation_type === 'self' || relation_type === 'subsidiary') && active_confirmed) {
    return 'active';
  }
  return 'passive';
}

/**
 * Guard: throw if an adapter that performs active techniques is selected under a
 * passive profile. Belt-and-suspenders on top of registry filtering.
 */
export function assertAllowed(adapter: Adapter, profile: Profile): void {
  if (profile === 'passive' && !adapter.supportsProfile('passive')) {
    throw new ForbiddenProfileError(adapter.name, profile);
  }
}
