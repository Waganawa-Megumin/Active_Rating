// Active Rating — deterministic evaluation (design v0.6 §D/E). Numbers are
// rules-only (LLM never overwrites them). From the org's open findings we
// compute per-vector A–F grades, a NIST CSF posture, and the overall 0–1000
// rating. All inputs are config-tunable weights.

import { ALL_VECTORS, type AttackVector, type Severity } from '@ar/shared';

const SEV_WEIGHT: Record<Severity, number> = {
  info: 0,
  low: 2,
  med: 6,
  high: 15,
  critical: 30,
};

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

function vectorGrade(score: number): Grade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 65) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}
function overallGrade(score: number): Grade {
  if (score >= 900) return 'A';
  if (score >= 750) return 'B';
  if (score >= 600) return 'C';
  if (score >= 450) return 'D';
  return 'F';
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export interface OpenFinding {
  vector: AttackVector;
  severity: Severity;
}

export interface VectorScore {
  vector: AttackVector;
  score: number;
  grade: Grade;
}
export interface Evaluation {
  vectors: VectorScore[];
  csf: { GV: number; ID: number; PR: number; DE: number; RS: number; RC: number };
  overall: number;
  grade: Grade;
}

export function computeEvaluation(
  findings: OpenFinding[],
  confirmedRatio: number,
): Evaluation {
  // per-vector deductions
  const byVector = new Map<AttackVector, number>();
  for (const v of ALL_VECTORS) byVector.set(v, 0);
  for (const f of findings) byVector.set(f.vector, (byVector.get(f.vector) ?? 0) + SEV_WEIGHT[f.severity]);

  const vectors: VectorScore[] = ALL_VECTORS.map((vector) => {
    const score = clamp(100 - (byVector.get(vector) ?? 0), 0, 100);
    return { vector, score, grade: vectorGrade(score) };
  });
  const vscore = (v: AttackVector) => vectors.find((x) => x.vector === v)!.score;

  // overall 0–1000: mean vector health scaled, floored by attribution confidence
  const base = mean(vectors.map((v) => v.score)) * 10; // 0–1000
  const overall = Math.round(clamp(base * (0.6 + 0.4 * confirmedRatio), 0, 1000));

  // NIST CSF (ASM informs ID/PR/DE strongly; RS indirect; RC/GV minimal — honest)
  const csf = {
    GV: Math.round(clamp(55 + 0.03 * overall, 0, 100)),
    ID: Math.round(clamp(20 + 80 * confirmedRatio, 0, 100)),
    PR: Math.round(mean([vscore('vpn'), vscore('pki'), vscore('webapp'), vscore('email')])),
    DE: Math.round(mean([vscore('netsvc'), vscore('cloud'), vscore('credential'), vscore('compromise')])),
    RS: Math.round(clamp(35 + 0.04 * overall, 0, 100)),
    RC: Math.round(clamp(20 + 0.02 * overall, 0, 100)),
  };

  return { vectors, csf, overall, grade: overallGrade(overall) };
}
