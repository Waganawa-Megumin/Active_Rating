// Active Rating — CONFIG-DRIVEN scoring weights.
//
// The confidence weights/thresholds are deliberately left undecided in the
// design (v0.2 §I, v1.0 §12) — they are tuning knobs, NOT constants. They live
// here so the diff engine never hardcodes them, and can be overridden at deploy
// time via worker/weights.json (see loadWeights).

export interface ConfidenceWeights {
  /** Positive contributions (points added). */
  positive: {
    /** Per independent source, capped by sourceCountCap. */
    source_count: number;
    active_resolved: number;
    in_owned_asn: number;
    cert_org_match: number;
    not_wildcard: number;
  };
  /** Penalties (points subtracted). */
  penalty: {
    parked: number;
    shared_cdn: number;
  };
  /** Independent sources beyond which source_count stops adding. */
  sourceCountCap: number;
  /** score >= confirmScore promotes candidate -> confirmed. */
  confirmScore: number;
  /** OR: this many independent sources also promotes to confirmed. */
  confirmedMinSources: number;
}

/** Default weights. Reasonable starting values; tune via override. */
export const DEFAULT_WEIGHTS: ConfidenceWeights = {
  positive: {
    source_count: 15,
    active_resolved: 30,
    in_owned_asn: 20,
    cert_org_match: 20,
    not_wildcard: 15,
  },
  penalty: {
    parked: 25,
    shared_cdn: 20,
  },
  sourceCountCap: 3,
  confirmScore: 60,
  confirmedMinSources: 2,
};

/**
 * Merge a partial override (e.g. parsed worker/weights.json) over the defaults.
 * Shallow-merges the nested groups so callers can override a single knob.
 */
export function loadWeights(override?: DeepPartial<ConfidenceWeights>): ConfidenceWeights {
  if (!override) return DEFAULT_WEIGHTS;
  return {
    positive: { ...DEFAULT_WEIGHTS.positive, ...override.positive },
    penalty: { ...DEFAULT_WEIGHTS.penalty, ...override.penalty },
    sourceCountCap: override.sourceCountCap ?? DEFAULT_WEIGHTS.sourceCountCap,
    confirmScore: override.confirmScore ?? DEFAULT_WEIGHTS.confirmScore,
    confirmedMinSources: override.confirmedMinSources ?? DEFAULT_WEIGHTS.confirmedMinSources,
  };
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };
