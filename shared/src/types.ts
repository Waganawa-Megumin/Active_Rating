// Active Rating — shared domain types.
// These enums mirror the integrated data model (design v1.0 §6) and are the
// single source of truth shared byte-for-byte between scanner and worker.

/** Scan strength decided by ownership relation. */
export type Profile = 'active' | 'passive';

/** Organization tree relation (design v1.0 §5 organizations.relation_type). */
export type RelationType = 'self' | 'subsidiary' | 'supplier' | 'partner' | 'watch';

/** Observed entity kinds (design v1.0 §6 entity_type). */
export type EntityType =
  | 'subdomain'
  | 'dns'
  | 'service'
  | 'cert'
  | 'web'
  | 'exposure'
  | 'asn'
  | 'vpn';

/** Append-only change log kinds (design v1.0 §5 changes.change_type). */
export type ChangeKind = 'ADDED' | 'REMOVED' | 'CHANGED';

/** Severity ladder (design v1.0 §6). */
export type Severity = 'info' | 'low' | 'med' | 'high' | 'critical';

/** Asset confidence state (design v0.2 — candidate vs confirmed). */
export type AssetState = 'candidate' | 'confirmed' | 'disputed';

/** Attribution confidence (design v0.2 §C). */
export type AttributionConf = 'low' | 'med' | 'high';

/** Business criticality weight basis (design v0.5). */
export type Criticality = 'crown' | 'high' | 'med' | 'low' | 'unknown';

/**
 * A normalized, comparison-ready observation emitted by a scanner adapter.
 * `identity` is the stable key for its entity_type (see identity.ts); `attributes`
 * are already normalized (see normalize.ts) so cosmetic churn never diffs.
 */
export interface NormalizedEntity {
  entity_type: EntityType;
  identity: string;
  attributes: Record<string, unknown>;
  observed_at: string; // ISO-8601
  /** Optional pointer to a raw record retained for evidence. */
  raw_ref?: string;
  /**
   * Per-observation confidence signals (design v0.2). Optional; the worker
   * scores confidence from these using config-driven weights.
   */
  signals?: ConfidenceSignals;
}

/** Inputs to the confidence formula (design v0.2 §B). */
export interface ConfidenceSignals {
  /** Count of independent sources that observed this identity this run. */
  source_count?: number;
  /** Confirmed alive via active resolution / probe. */
  active_resolved?: boolean;
  /** Resolves inside an owned ASN/CIDR. */
  in_owned_asn?: boolean;
  /** Certificate Organization matches the company. */
  cert_org_match?: boolean;
  /** Not derived only from a wildcard DNS response. */
  not_wildcard?: boolean;
  /** Penalty: parked / sinkhole. */
  parked?: boolean;
  /** Penalty: shared CDN IP (unattributable). */
  shared_cdn?: boolean;
}

/** A scan target resolved from the registration store (D1). */
export interface EnrolledDomain {
  domain_id: string;
  organization_id: string;
  fqdn: string;
  relation_type: RelationType;
  active_confirmed: boolean;
  slack_channel?: string | null;
}
