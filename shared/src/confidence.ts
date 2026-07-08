// Active Rating — asset confidence scoring (design v0.2 §B).
//
//   confidence = w1*source_count_norm + w2*active_resolved + w3*in_owned_asn
//              + w4*cert_org_match + w5*not_wildcard
//              - p1*parked - p2*shared_cdn
//
// Promotion: score >= confirmScore  OR  >= confirmedMinSources independent
// sources OR active-resolved  =>  state 'confirmed'; else 'candidate'.
// Weights are injected (config-driven) — never hardcoded here.

import type { ConfidenceWeights } from './config/weights.js';
import { DEFAULT_WEIGHTS } from './config/weights.js';
import type { AssetState, ConfidenceSignals } from './types.js';

export interface ConfidenceResult {
  /** 0–100, clamped. */
  score: number;
  /** 'candidate' | 'confirmed' (disputes are set elsewhere). */
  state: Exclude<AssetState, 'disputed'>;
}

export function scoreConfidence(
  signals: ConfidenceSignals | undefined,
  weights: ConfidenceWeights = DEFAULT_WEIGHTS,
): ConfidenceResult {
  const s = signals ?? {};
  const p = weights.positive;
  const pen = weights.penalty;

  const sourceCount = Math.max(0, s.source_count ?? 0);
  const sourceNorm = Math.min(sourceCount, weights.sourceCountCap) / weights.sourceCountCap;

  let score = 0;
  score += p.source_count * sourceNorm;
  if (s.active_resolved) score += p.active_resolved;
  if (s.in_owned_asn) score += p.in_owned_asn;
  if (s.cert_org_match) score += p.cert_org_match;
  if (s.not_wildcard) score += p.not_wildcard;
  if (s.parked) score -= pen.parked;
  if (s.shared_cdn) score -= pen.shared_cdn;

  score = Math.max(0, Math.min(100, Math.round(score)));

  const promoted =
    score >= weights.confirmScore ||
    sourceCount >= weights.confirmedMinSources ||
    Boolean(s.active_resolved);

  return { score, state: promoted ? 'confirmed' : 'candidate' };
}
