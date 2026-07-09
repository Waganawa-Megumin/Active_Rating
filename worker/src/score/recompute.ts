// Active Rating — recompute an org's findings + deterministic scores from its
// current confirmed assets. Idempotent (findings resolve when assets vanish).

import { ulid } from 'ulidx';
import { findingForAsset, slaDue, sha256Hex, type Severity } from '@ar/shared';
import type { Bindings } from '../env.js';
import { computeEvaluation, type Evaluation, type OpenFinding } from './evaluate.js';
import {
  activeAssetsForOrg,
  upsertFinding,
  resolveFindingsNotIn,
  replaceVectorsStmts,
  replaceFrameworkStmts,
  insertOverall,
} from '../db/queries.js';
import { batchChunked } from '../db/batch.js';

const SEV_SCORE: Record<Severity, number> = { info: 1, low: 3, med: 5, high: 8, critical: 9.5 };

export async function recomputeOrg(
  env: Bindings,
  orgId: string,
  now: string,
): Promise<Evaluation> {
  const assets = await activeAssetsForOrg(env.DB, orgId);
  const stmts: D1PreparedStatement[] = [];
  const keepIds: string[] = [];
  const open: OpenFinding[] = [];
  let total = 0;
  let confirmed = 0;

  for (const a of assets) {
    total++;
    if (a.state === 'confirmed') confirmed++;
    let attrs: Record<string, unknown> = {};
    try {
      attrs = JSON.parse(a.attrs_json) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
    const df = findingForAsset(a.entity_type as never, attrs);
    if (!df) continue;
    const fid = await sha256Hex(`${a.id}:${df.finding_type}`);
    stmts.push(
      upsertFinding(env.DB, {
        id: fid,
        asset_id: a.id,
        org_id: orgId,
        finding_type: df.finding_type,
        severity: df.severity,
        score: SEV_SCORE[df.severity],
        evidence_json: JSON.stringify({ vector: df.vector }),
        sla_due: slaDue(now, df.severity),
        first_seen: now,
        last_seen: now,
      }),
    );
    keepIds.push(fid);
    open.push({ vector: df.vector, severity: df.severity });
  }

  stmts.push(resolveFindingsNotIn(env.DB, orgId, keepIds, now));

  const confirmedRatio = total ? confirmed / total : 1;
  const evaluation = computeEvaluation(open, confirmedRatio);
  const period = now.slice(0, 10);

  stmts.push(
    ...replaceVectorsStmts(
      env.DB,
      orgId,
      period,
      evaluation.vectors.map((v) => ({ vector: v.vector, grade: v.grade, score: v.score })),
    ),
  );
  stmts.push(...replaceFrameworkStmts(env.DB, orgId, period, evaluation.csf));
  stmts.push(
    insertOverall(env.DB, {
      id: ulid(),
      org_id: orgId,
      score: evaluation.overall,
      grade: evaluation.grade,
      confidence: Math.round(confirmedRatio * 100),
      computed_at: now,
    }),
  );

  await batchChunked(env.DB, stmts);
  return evaluation;
}
