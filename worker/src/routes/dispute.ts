// Active Rating — POST /dispute (design v0.7 §B-3 反証モード). Records a dispute
// against an asset/finding, revalidates against current evidence, and either
// upholds (evidence still stands) or retracts (evidence expired/gone). Retractions
// feed the FP-rate KPI.

import { Hono } from 'hono';
import { ulid } from 'ulidx';
import { z } from 'zod';
import type { Bindings } from '../env.js';
import { getAsset, setAssetState, insertDispute, evidenceForAsset } from '../db/queries.js';

export const disputeRoute = new Hono<{ Bindings: Bindings }>();

const DisputeSchema = z
  .object({
    asset_id: z.string().min(1),
    finding_id: z.string().min(1).optional(),
    claim: z.string().min(1),
  })
  .strict();

disputeRoute.post('/dispute', async (c) => {
  const parsed = DisputeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'validation', issues: parsed.error.issues }, 422);
  const { asset_id, finding_id, claim } = parsed.data;

  const asset = await getAsset(c.env.DB, asset_id);
  if (!asset) return c.text('unknown asset_id', 404);

  // Revalidate: is there fresh, non-expired evidence backing this asset?
  const bundles = await evidenceForAsset(c.env.DB, asset_id);
  const now = Date.now();
  const stillValid = bundles.some((b) => {
    const observedAt = Date.parse(String(b.observed_at));
    const ttl = b.ttl_sec == null ? null : Number(b.ttl_sec);
    if (Number.isNaN(observedAt)) return false;
    if (ttl == null) return true; // no TTL => does not expire
    return observedAt + ttl * 1000 >= now;
  });

  const outcome = stillValid ? 'upheld' : 'retracted';
  const disputeId = ulid();
  await insertDispute(c.env.DB, {
    id: disputeId,
    finding_id: finding_id ?? null,
    asset_id,
    claim,
    outcome,
    revalidated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  }).run();

  // Retracted => the claim of error stands: mark the asset disputed (auto-withdraw).
  if (outcome === 'retracted') {
    await setAssetState(c.env.DB, asset_id, 'disputed').run();
  }

  return c.json({
    ok: true,
    dispute_id: disputeId,
    outcome,
    evidence_count: bundles.length,
    message:
      outcome === 'upheld'
        ? '証跡は依然有効です。帰属根拠を提示し、評価を維持します。'
        : '証跡が期限切れ/不成立のため、評価を自動撤回しました（FP率に反映）。',
  });
});
