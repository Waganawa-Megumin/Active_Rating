// Active Rating — read-only /api/* for the dashboard + /api/enrollment for the
// scanner. No auth in P1 (front the deployment with Cloudflare Access); never
// exposes secrets.

import { Hono } from 'hono';
import type { Bindings } from '../env.js';
import {
  listOrgs,
  listEnrollment,
  recentChanges,
  listAssets,
  getAsset,
  evidenceForAsset,
  getEvidence,
  listDisputes,
  disputeStats,
  orgAssetSummary,
  orgSeveritySummary,
} from '../db/queries.js';
import { computeProvisionalRating } from '../score/provisional.js';
import type { Severity } from '@ar/shared';

export const apiRoute = new Hono<{ Bindings: Bindings }>();

apiRoute.get('/api/health', (c) => c.json({ ok: true, offline: c.env.OFFLINE === '1' }));

// Org tree (with profile derivation for badges).
apiRoute.get('/api/organizations', async (c) => {
  const orgs = await listOrgs(c.env.DB);
  return c.json(
    orgs.map((o) => ({
      ...o,
      active_confirmed: !!o.active_confirmed,
      profile:
        (o.relation_type === 'self' || o.relation_type === 'subsidiary') && o.active_confirmed
          ? 'active'
          : 'passive',
    })),
  );
});

// Enrollment feed consumed by the scanner orchestrator (targets from D1).
apiRoute.get('/api/enrollment', async (c) => {
  const rows = await listEnrollment(c.env.DB);
  return c.json(
    rows.map((r: Record<string, unknown>) => ({
      domain_id: r.domain_id,
      organization_id: r.organization_id,
      fqdn: r.fqdn,
      relation_type: r.relation_type,
      active_confirmed: !!r.active_confirmed,
      slack_channel: r.slack_channel ?? null,
    })),
  );
});

apiRoute.get('/api/changes', async (c) => {
  const limit = Math.min(1000, Number(c.req.query('limit') ?? 200));
  return c.json(await recentChanges(c.env.DB, limit));
});

apiRoute.get('/api/assets', async (c) => {
  const limit = Math.min(2000, Number(c.req.query('limit') ?? 500));
  const rows = await listAssets(c.env.DB, limit);
  return c.json(rows.map((a) => ({ ...a, attrs: safeJson(a.attrs_json) })));
});

apiRoute.get('/api/assets/:id', async (c) => {
  const a = await getAsset(c.env.DB, c.req.param('id'));
  if (!a) return c.text('not found', 404);
  const evidence = await evidenceForAsset(c.env.DB, a.id);
  return c.json({ ...a, attrs: safeJson(a.attrs_json), evidence });
});

apiRoute.get('/api/evidence/:id', async (c) => {
  const e = await getEvidence(c.env.DB, c.req.param('id'));
  if (!e) return c.text('not found', 404);
  return c.json(e);
});

apiRoute.get('/api/disputes', async (c) => {
  return c.json(await listDisputes(c.env.DB));
});

// FP-rate KPI (design v0.7 §B-3): retracted / total disputes.
apiRoute.get('/api/fp-rate', async (c) => {
  const s = await disputeStats(c.env.DB);
  const total = Number(s.total ?? 0);
  const retracted = Number(s.retracted ?? 0);
  return c.json({
    total_disputes: total,
    retracted,
    upheld: Number(s.upheld ?? 0),
    fp_rate: total > 0 ? Number((retracted / total).toFixed(4)) : 0,
  });
});

// Provisional Active Rating gauge + CSF radar for an org.
apiRoute.get('/api/rating/:orgId', async (c) => {
  const orgId = c.req.param('orgId');
  const assetSummary = await orgAssetSummary(c.env.DB, orgId);
  const sevSummary = await orgSeveritySummary(c.env.DB, orgId);

  let total = 0;
  let confirmed = 0;
  for (const r of assetSummary) {
    total += Number(r.n ?? 0);
    confirmed += Number(r.confirmed ?? 0);
  }
  const severityCounts: Partial<Record<Severity, number>> = {};
  for (const r of sevSummary) severityCounts[r.severity as Severity] = Number(r.n ?? 0);

  const rating = computeProvisionalRating({
    totalAssets: total,
    confirmedAssets: confirmed,
    severityCounts,
  });
  return c.json({ org_id: orgId, assets: { total, confirmed }, severityCounts, ...rating });
});

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
