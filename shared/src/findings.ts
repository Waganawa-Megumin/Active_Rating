// Active Rating — deterministic finding derivation + attack-vector taxonomy
// (design v0.6 §D, v0.2 §D). Findings are a function of current confirmed assets
// (continuous evaluation): if an asset disappears, its finding resolves.

import type { EntityType, Severity } from './types.js';

export type AttackVector =
  | 'vpn'
  | 'webapp'
  | 'email'
  | 'dns'
  | 'credential'
  | 'cloud'
  | 'pki'
  | 'netsvc'
  | 'compromise';

export const ALL_VECTORS: AttackVector[] = [
  'vpn',
  'webapp',
  'email',
  'dns',
  'credential',
  'cloud',
  'pki',
  'netsvc',
  'compromise',
];

export interface DerivedFinding {
  finding_type: string;
  vector: AttackVector;
  severity: Severity;
}

/** SLA window (days) per severity; 0 = no SLA. */
export const SLA_DAYS: Record<Severity, number> = {
  info: 0,
  low: 90,
  med: 30,
  high: 7,
  critical: 3,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const CERT_NEAR_EXPIRY_DAYS = 30;

function certNearExpiry(attrs: Record<string, unknown>): boolean {
  const notAfter = attrs.not_after ?? attrs.notAfter;
  if (typeof notAfter !== 'string') return false;
  const t = Date.parse(notAfter);
  if (Number.isNaN(t)) return false;
  return t - Date.now() <= CERT_NEAR_EXPIRY_DAYS * DAY_MS;
}

/**
 * Derive a finding from a current asset's type + normalized attributes, or null
 * if the asset is inventory-only (subdomain/dns/asn without an issue).
 */
export function findingForAsset(
  entity_type: EntityType,
  attrs: Record<string, unknown>,
): DerivedFinding | null {
  switch (entity_type) {
    case 'exposure': {
      const bucket = String(attrs.bucket ?? '').toLowerCase();
      const leaks = bucket === 'leaks' || bucket === 'leak';
      return {
        finding_type: leaks ? 'vpn_cred_exposure' : 'exposed_service',
        vector: leaks ? 'credential' : 'cloud',
        severity: leaks ? 'critical' : 'high',
      };
    }
    case 'vpn':
      return { finding_type: 'vpn_misconfig', vector: 'vpn', severity: 'med' };
    case 'service':
      return { finding_type: 'exposed_service', vector: 'netsvc', severity: 'med' };
    case 'web':
      return { finding_type: 'exposed_service', vector: 'webapp', severity: 'low' };
    case 'cert':
      return certNearExpiry(attrs)
        ? { finding_type: 'pki', vector: 'pki', severity: 'med' }
        : null;
    case 'subdomain':
    case 'dns':
    case 'asn':
      return null;
    default:
      return null;
  }
}

/** ISO timestamp `days` from `fromIso` (SLA due date); null when days=0. */
export function slaDue(fromIso: string, severity: Severity): string | null {
  const days = SLA_DAYS[severity];
  if (!days) return null;
  return new Date(Date.parse(fromIso) + days * DAY_MS).toISOString();
}
