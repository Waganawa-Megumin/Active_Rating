// Active Rating — provisional P1 rating (deterministic, evidence-based).
//
// The full framework/vector/overall model is P5. For P1 the dashboard needs
// real numbers, so we compute a transparent provisional score from what P1
// actually measures: confirmed-asset ratio and the severity mix of changes.
// Numbers are deterministic (never from an LLM), matching the design principle
// "score truth is always deterministic".

import type { Severity } from '@ar/shared';

export interface ProvisionalRating {
  /** 0–1000 overall (design v0.6 scale). Higher = healthier. */
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  /** 0–100 per NIST CSF function (design v0.6 §C: ASM informs ID/PR/DE strongly). */
  csf: { GV: number; ID: number; PR: number; DE: number; RS: number; RC: number };
  provisional: true;
  basis: { confirmed_ratio: number; severity_penalty: number };
}

const SEV_WEIGHT: Record<Severity, number> = { info: 0, low: 1, med: 4, high: 12, critical: 30 };

function grade(score: number): ProvisionalRating['grade'] {
  if (score >= 900) return 'A';
  if (score >= 750) return 'B';
  if (score >= 600) return 'C';
  if (score >= 450) return 'D';
  return 'F';
}

export function computeProvisionalRating(input: {
  totalAssets: number;
  confirmedAssets: number;
  severityCounts: Partial<Record<Severity, number>>;
}): ProvisionalRating {
  const confirmedRatio = input.totalAssets > 0 ? input.confirmedAssets / input.totalAssets : 1;

  let penalty = 0;
  for (const [sev, n] of Object.entries(input.severityCounts)) {
    penalty += SEV_WEIGHT[sev as Severity] * (n ?? 0);
  }
  // Diminishing penalty, capped so a single scan can't zero the score.
  const penaltyScore = Math.min(500, penalty);

  const base = 1000 * (0.4 + 0.6 * confirmedRatio); // attribution confidence floor
  const score = Math.max(0, Math.round(base - penaltyScore));

  // ASM contributes strongly to ID/PR/DE, indirectly to RS, minimally to RC/GV.
  const health = score / 1000;
  const csf = {
    GV: Math.round(50 + 30 * health),
    ID: Math.round(20 + 80 * confirmedRatio),
    PR: Math.round(30 + 70 * health),
    DE: Math.round(40 + 60 * health),
    RS: Math.round(30 + 40 * health),
    RC: Math.round(20 + 20 * health),
  };

  return {
    score,
    grade: grade(score),
    csf,
    provisional: true,
    basis: { confirmed_ratio: Number(confirmedRatio.toFixed(3)), severity_penalty: penaltyScore },
  };
}
