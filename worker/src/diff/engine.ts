// Active Rating — diff engine (design v0.1 §7, v0.2). Given a validated ingest
// payload it computes ADDED/CHANGED/REMOVED against current state, scores
// confidence, applies debounce (stable_runs++), builds evidence bundles, and
// writes everything in one D1 batch.

import { ulid } from 'ulidx';
import {
  assetIdOf,
  attributesEqual,
  canonicalJson,
  loadWeights,
  scoreConfidence,
  severityOf,
  type ConfidenceWeights,
  type IngestPayload,
  type NormalizedEntity,
  type Severity,
} from '@ar/shared';
import type { Bindings } from '../env.js';
import {
  insertChange,
  insertSnapshot,
  markAssetGone,
  priorAssets,
  touchAsset,
  upsertAsset,
  type AssetRow,
} from '../db/queries.js';
import { buildEvidence, methodFor } from './evidence.js';

export interface DiffSummary {
  domain_id: string;
  org_id: string;
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
  bySeverity: Record<Severity, number>;
  changeIds: string[];
  touchedAssetIds: string[];
}

const ZERO_SEV = (): Record<Severity, number> => ({ info: 0, low: 0, med: 0, high: 0, critical: 0 });

export async function runDiff(
  env: Bindings,
  payload: IngestPayload,
  opts: { org_id: string; weights?: ConfidenceWeights },
): Promise<DiffSummary> {
  const weights = opts.weights ?? loadWeights();
  const now = payload.run_at;
  const summary: DiffSummary = {
    domain_id: payload.domain_id,
    org_id: opts.org_id,
    added: 0,
    changed: 0,
    removed: 0,
    unchanged: 0,
    bySeverity: ZERO_SEV(),
    changeIds: [],
    touchedAssetIds: [],
  };

  // Statements executed atomically at the end.
  const stmts: D1PreparedStatement[] = [];

  // Group incoming entities by type so REMOVED is scoped per entity_type.
  const byType = new Map<string, NormalizedEntity[]>();
  for (const e of payload.entities) {
    const arr = byType.get(e.entity_type) ?? [];
    arr.push(e);
    byType.set(e.entity_type, arr);
  }

  for (const [entityType, entities] of byType) {
    const prior = await priorAssets(env.DB, payload.domain_id, entityType);
    const priorById = new Map<string, AssetRow>(prior.map((p) => [p.id, p]));
    const seen = new Set<string>();

    for (const entity of entities) {
      const assetId = await assetIdOf(payload.domain_id, entity.entity_type, entity.identity);
      seen.add(assetId);
      const conf = scoreConfidence(entity.signals, weights);
      const attrsJson = canonicalJson(entity.attributes);
      const existing = priorById.get(assetId);

      if (!existing) {
        // ADDED
        const asset: AssetRow = {
          id: assetId,
          domain_id: payload.domain_id,
          org_id: opts.org_id,
          entity_type: entity.entity_type,
          identity: entity.identity,
          attrs_json: attrsJson,
          confidence: conf.score,
          state: conf.state,
          attribution_org_id: entity.signals?.in_owned_asn ? opts.org_id : null,
          attribution_conf: entity.signals?.in_owned_asn ? 'med' : 'low',
          source_count: Math.max(1, entity.signals?.source_count ?? 1),
          stable_runs: 0,
          criticality: 'unknown',
          data_sensitivity: 'unknown',
          first_seen: now,
          last_seen: now,
          status: 'active',
        };
        stmts.push(upsertAsset(env.DB, asset));
        const changeId = ulid();
        const severity = severityOf('ADDED', entity);
        stmts.push(
          insertChange(env.DB, {
            id: changeId,
            domain_id: payload.domain_id,
            org_id: opts.org_id,
            asset_id: assetId,
            entity_type: entity.entity_type,
            change_type: 'ADDED',
            severity,
            before_json: null,
            after_json: attrsJson,
            detected_at: now,
            notified: 0,
          }),
        );
        stmts.push(
          await buildEvidence(env, {
            change_id: changeId,
            asset_id: assetId,
            method: methodFor(entity, payload.source.adapter),
            kind: 'ADDED',
            before: null,
            entity,
            confidence: conf.score,
            observed_at: now,
          }),
        );
        summary.added++;
        summary.bySeverity[severity]++;
        summary.changeIds.push(changeId);
        summary.touchedAssetIds.push(assetId);
      } else if (!attributesEqual(JSON.parse(existing.attrs_json), entity.attributes)) {
        // CHANGED
        const asset: AssetRow = {
          ...existing,
          attrs_json: attrsJson,
          confidence: conf.score,
          state: existing.state === 'disputed' ? 'disputed' : conf.state,
          source_count: Math.max(existing.source_count, entity.signals?.source_count ?? 1),
          stable_runs: existing.stable_runs,
          last_seen: now,
          status: 'active',
        };
        stmts.push(upsertAsset(env.DB, asset));
        const changeId = ulid();
        const severity = severityOf('CHANGED', entity);
        stmts.push(
          insertChange(env.DB, {
            id: changeId,
            domain_id: payload.domain_id,
            org_id: opts.org_id,
            asset_id: assetId,
            entity_type: entity.entity_type,
            change_type: 'CHANGED',
            severity,
            before_json: existing.attrs_json,
            after_json: attrsJson,
            detected_at: now,
            notified: 0,
          }),
        );
        stmts.push(
          await buildEvidence(env, {
            change_id: changeId,
            asset_id: assetId,
            method: methodFor(entity, payload.source.adapter),
            kind: 'CHANGED',
            before: JSON.parse(existing.attrs_json),
            entity,
            confidence: conf.score,
            observed_at: now,
          }),
        );
        summary.changed++;
        summary.bySeverity[severity]++;
        summary.changeIds.push(changeId);
        summary.touchedAssetIds.push(assetId);
      } else {
        // UNCHANGED — debounce: touch last_seen + stable_runs++
        stmts.push(touchAsset(env.DB, assetId, now));
        summary.unchanged++;
      }
    }

    // REMOVED — only when this source is authoritative for the entity_type.
    if (payload.source.is_authoritative) {
      for (const p of prior) {
        if (seen.has(p.id)) continue;
        stmts.push(markAssetGone(env.DB, p.id, now));
        const changeId = ulid();
        stmts.push(
          insertChange(env.DB, {
            id: changeId,
            domain_id: payload.domain_id,
            org_id: opts.org_id,
            asset_id: p.id,
            entity_type: p.entity_type,
            change_type: 'REMOVED',
            severity: 'low',
            before_json: p.attrs_json,
            after_json: null,
            detected_at: now,
            notified: 0,
          }),
        );
        summary.removed++;
        summary.bySeverity.low++;
        summary.changeIds.push(changeId);
      }
    }
  }

  // Snapshot row for this run.
  stmts.push(
    insertSnapshot(env.DB, {
      id: payload.run_id,
      domain_id: payload.domain_id,
      source: payload.source.adapter,
      profile: payload.source.profile,
      run_at: now,
      asset_count: payload.entities.length,
    }),
  );

  if (stmts.length > 0) await env.DB.batch(stmts);
  return summary;
}
