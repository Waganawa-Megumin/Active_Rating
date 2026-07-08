// Active Rating — adapter registry. Selects the enabled adapter set for a run.
// In offline mode only the fixtures adapter runs. Keyed adapters are excluded in
// Phase 1 (declared but not yet implemented).

import type { Profile } from '@ar/shared';
import type { Adapter } from './types.js';
import { CrtShAdapter } from './crtsh.js';
import { OfflineAdapter } from './offline.js';

export interface RegistryOptions {
  offline: boolean;
}

/** Return the adapters to run for a given profile. */
export function getAdapters(profile: Profile, opts: RegistryOptions): Adapter[] {
  if (opts.offline) return [new OfflineAdapter()];

  const all: Adapter[] = [
    new CrtShAdapter(),
    // Phase 4+: new IntelxAdapter(), new ShodanAdapter(), new HibpAdapter(), ...
  ];
  // Only adapters safe for this profile (passive excludes active-only sources).
  return all.filter((a) => a.supportsProfile(profile));
}
