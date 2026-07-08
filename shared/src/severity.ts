// Active Rating — change severity rules (design v0.1 §7 severity_of, v0.2 §D-1).

import type { ChangeKind, NormalizedEntity, Severity } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Certificate is "near expiry" within this many days of notAfter. */
export const CERT_NEAR_EXPIRY_DAYS = 30;

function certNearExpiry(attrs: Record<string, unknown>): boolean {
  const notAfter = attrs.not_after ?? attrs.notAfter;
  if (typeof notAfter !== 'string') return false;
  const t = Date.parse(notAfter);
  if (Number.isNaN(t)) return false;
  return t - Date.now() <= CERT_NEAR_EXPIRY_DAYS * DAY_MS;
}

function isLeakExposure(entity: NormalizedEntity): boolean {
  if (entity.entity_type !== 'exposure') return false;
  const bucket = String(entity.attributes.bucket ?? '').toLowerCase();
  return bucket === 'leaks' || bucket === 'leak';
}

/**
 * Initial severity ruleset (tunable). Returns the severity for a change.
 *  - new subdomain / new open service  -> med
 *  - new exposure in a leaks bucket     -> high
 *  - cert added/changed near expiry     -> med
 *  - REMOVED (anything)                 -> low
 *  - otherwise                          -> info
 */
export function severityOf(kind: ChangeKind, entity: NormalizedEntity): Severity {
  if (kind === 'REMOVED') return 'low';

  if (kind === 'ADDED') {
    if (isLeakExposure(entity)) return 'high';
    if (entity.entity_type === 'subdomain' || entity.entity_type === 'service') return 'med';
    if (entity.entity_type === 'vpn') return 'med';
  }

  if (entity.entity_type === 'cert' && certNearExpiry(entity.attributes)) return 'med';

  if (kind === 'CHANGED' && entity.entity_type === 'service') return 'med';

  return 'info';
}

const ORDER: Record<Severity, number> = {
  info: 0,
  low: 1,
  med: 2,
  high: 3,
  critical: 4,
};

/** Numeric rank for sorting/thresholds. */
export function severityRank(s: Severity): number {
  return ORDER[s];
}

/** True when `s` is at least `min` on the severity ladder. */
export function severityAtLeast(s: Severity, min: Severity): boolean {
  return ORDER[s] >= ORDER[min];
}
