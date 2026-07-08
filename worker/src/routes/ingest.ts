// Active Rating — POST /ingest (design v1.0 §9). HMAC verify over RAW bytes,
// then zod validate, then diff, then Slack + enqueue re-eval.

import { Hono } from 'hono';
import { verifyHmac, IngestPayloadSchema } from '@ar/shared';
import type { Bindings, ReevalMessage } from '../env.js';
import { getDomain } from '../db/queries.js';
import { runDiff } from '../diff/engine.js';
import { buildSlackMessage, notifySlack } from '../notify/slack.js';
import { loadWorkerWeights } from '../weights.js';

export const ingestRoute = new Hono<{ Bindings: Bindings }>();

ingestRoute.post('/ingest', async (c) => {
  // 1) Read RAW bytes BEFORE any parse (HMAC binds these exact bytes).
  const raw = new Uint8Array(await c.req.arrayBuffer());

  const verify = await verifyHmac({
    secret: c.env.INGEST_HMAC_SECRET,
    method: 'POST',
    path: '/ingest',
    headers: c.req.raw.headers,
    rawBody: raw,
  });
  if (!verify.ok) return c.text(verify.reason, verify.status);

  // 2) Parse + validate.
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return c.text('invalid json', 400);
  }
  const parsed = IngestPayloadSchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 422);
  }
  const payload = parsed.data;

  // 3) Resolve domain -> org (authoritative org_id from the store, not payload).
  const domain = await getDomain(c.env.DB, payload.domain_id);
  if (!domain) return c.text('unknown domain_id', 404);

  // 4) Diff.
  const weights = await loadWorkerWeights(c.env);
  const summary = await runDiff(c.env, payload, { org_id: domain.org_id, weights });

  // 5) Notify (batched, med+ immediate).
  const org = await c.env.DB.prepare('SELECT name FROM organizations WHERE id = ?1')
    .bind(domain.org_id)
    .first<{ name: string }>();
  const message = buildSlackMessage({
    orgName: org?.name ?? domain.org_id,
    fqdn: domain.fqdn,
    summary,
    detectedAt: payload.run_at,
  });
  await notifySlack(c.env, c.env.SLACK_WEBHOOK_URL, message, summary);

  // 6) Event-driven: enqueue touched assets for pinpoint re-eval (best-effort).
  if (c.env.REEVAL_QUEUE && summary.touchedAssetIds.length > 0) {
    try {
      await c.env.REEVAL_QUEUE.sendBatch(
        summary.touchedAssetIds.slice(0, 100).map((asset_id) => ({
          body: { asset_id, reason: 'ingest' } satisfies ReevalMessage,
        })),
      );
    } catch {
      // queue not bound locally — non-fatal
    }
  }

  return c.json({
    ok: true,
    domain_id: payload.domain_id,
    added: summary.added,
    changed: summary.changed,
    removed: summary.removed,
    unchanged: summary.unchanged,
    bySeverity: summary.bySeverity,
  });
});
