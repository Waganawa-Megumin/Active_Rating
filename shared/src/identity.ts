// Active Rating — entity identity keys + deterministic asset_id (design v0.1 §5).
//
// The diff engine keys prior vs incoming state on `asset_id`, which MUST be
// reproducible across runs and identical on scanner and worker. It is a hash of
// (domain_id, entity_type, identity) — never random.

import { sha256Hex } from './hmac.js';
import type { EntityType, NormalizedEntity } from './types.js';

const UNIT_SEP = ''; // ASCII US, unambiguous field separator

/** Lowercase + strip a single trailing dot from a hostname. */
export function canonicalHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

/**
 * Compute the stable identity string for an entity's key fields.
 * Callers pass the type-specific key parts; this enforces the canonical shape
 * (design v0.1 §5 identity column).
 */
export function identityOf(
  entity_type: EntityType,
  parts: Record<string, string | number | undefined>,
): string {
  switch (entity_type) {
    case 'subdomain':
      return canonicalHost(String(parts.fqdn ?? ''));
    case 'dns':
      return `${canonicalHost(String(parts.name ?? ''))}|${String(parts.type ?? '').toUpperCase()}`;
    case 'service':
      return `${String(parts.ip ?? '')}:${String(parts.port ?? '')}/${String(parts.proto ?? 'tcp').toLowerCase()}`;
    case 'cert':
      return String(parts.sha256 ?? '').toLowerCase();
    case 'web':
      return String(parts.url ?? '').trim();
    case 'exposure':
      return `${String(parts.source ?? '')}:${String(parts.storageid ?? '')}`;
    case 'asn':
      return String(parts.cidr ?? '');
    case 'vpn':
      return canonicalHost(String(parts.fqdn ?? parts.host ?? ''));
    default: {
      const _exhaustive: never = entity_type;
      return String(_exhaustive);
    }
  }
}

/**
 * Deterministic asset id: hex(SHA-256(domain_id ␟ entity_type ␟ identity)).
 * Stable across snapshots — this is the cross-run join key.
 */
export function assetIdOf(
  domain_id: string,
  entity_type: EntityType,
  identity: string,
): Promise<string> {
  return sha256Hex([domain_id, entity_type, identity].join(UNIT_SEP));
}

/** Convenience: compute the asset id for a normalized entity. */
export function assetIdForEntity(
  domain_id: string,
  entity: Pick<NormalizedEntity, 'entity_type' | 'identity'>,
): Promise<string> {
  return assetIdOf(domain_id, entity.entity_type, entity.identity);
}
