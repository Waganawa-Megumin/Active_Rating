// Active Rating — evidence bundle builder (design v0.7 §B "証跡なき評価を出さない").
// Every emitted change gets an evidence bundle: canonical before/after proof
// stored in R2, with a row in evidence_bundles pointing at the R2 key.

import { ulid } from 'ulidx';
import { canonicalJson } from '@ar/shared';
import type { ChangeKind, NormalizedEntity } from '@ar/shared';
import type { Bindings } from '../env.js';
import { insertEvidence } from '../db/queries.js';

export interface EvidenceInput {
  change_id: string;
  asset_id: string;
  method: string; // active_resolve | http_probe | cert_ct | ...
  kind: ChangeKind;
  before?: Record<string, unknown> | null;
  entity: NormalizedEntity;
  confidence: number;
  observed_at: string;
  ttl_sec?: number;
}

/**
 * Build an evidence bundle: writes the canonical proof JSON to R2 and returns the
 * D1 insert statement for the evidence_bundles row (executed in the ingest batch).
 */
export async function buildEvidence(
  env: Bindings,
  input: EvidenceInput,
): Promise<D1PreparedStatement> {
  const id = ulid();
  const proof = {
    kind: input.kind,
    method: input.method,
    identity: input.entity.identity,
    entity_type: input.entity.entity_type,
    before: input.before ?? null,
    after: input.entity.attributes,
    raw_ref: input.entity.raw_ref ?? null,
    signals: input.entity.signals ?? null,
  };
  const proofJson = canonicalJson(proof);

  // Persist the full proof snapshot in R2 (best-effort; the row still records it).
  const snapshotRef = `evidence/${input.asset_id}/${id}.json`;
  try {
    await env.EVIDENCE.put(snapshotRef, proofJson, {
      httpMetadata: { contentType: 'application/json' },
    });
  } catch {
    // R2 unavailable (e.g. binding missing in a minimal local run) — the
    // evidence row still carries proof_json inline, so nothing is lost.
  }

  const sourcesJson = JSON.stringify([input.entity.entity_type]);

  return insertEvidence(env.DB, {
    id,
    finding_id: null,
    asset_id: input.asset_id,
    change_id: input.change_id,
    method: input.method,
    proof_json: proofJson,
    snapshot_ref: snapshotRef,
    sources_json: sourcesJson,
    confidence: input.confidence,
    observed_at: input.observed_at,
    ttl_sec: input.ttl_sec ?? null,
  });
}

/** Method label from the observing adapter/entity. */
export function methodFor(entity: NormalizedEntity, adapter: string): string {
  if (entity.entity_type === 'cert') return 'cert_ct';
  if (entity.entity_type === 'web') return 'http_probe';
  if (entity.entity_type === 'dns' || entity.entity_type === 'subdomain')
    return entity.signals?.active_resolved ? 'active_resolve' : 'passive_ct';
  return adapter === 'crt.sh' ? 'cert_ct' : 'ti_corroboration';
}
