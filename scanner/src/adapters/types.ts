// Active Rating — adapter interface. Every source implements fetch(domain,
// profile) -> NormalizedEntity[]. supportsProfile encodes whether the adapter is
// safe under passive (read-only) vs requires active.

import type { EnrolledDomain, NormalizedEntity, Profile } from '@ar/shared';

export interface Adapter {
  /** Stable adapter name, matches ingest source.adapter (e.g. "crt.sh"). */
  readonly name: string;
  /** Requires an API key to operate. */
  readonly requiresKey: boolean;
  /**
   * Whether this source is authoritative for its entity types — i.e. a complete
   * enumeration, so unseen prior assets may be marked REMOVED. crt.sh is NOT
   * authoritative (CT is additive); the offline fixture adapter IS.
   */
  readonly authoritative: boolean;
  /** True if the adapter is safe to run under the given profile. */
  supportsProfile(p: Profile): boolean;
  /** Fetch + normalize observations for one domain. */
  fetch(domain: EnrolledDomain, profile: Profile): Promise<NormalizedEntity[]>;
}
