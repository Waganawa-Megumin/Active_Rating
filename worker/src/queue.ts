// Active Rating — queue consumer (design v1.0 §9 queue). Event-driven pinpoint
// re-evaluation of impacted assets only (not a full re-scan). P1: recompute
// confidence/state for a touched asset from its stored signals.

import { scoreConfidence, loadWeights } from '@ar/shared';
import type { Bindings, ReevalMessage } from './env.js';
import { getAsset, setAssetState } from './db/queries.js';

export async function handleReeval(
  batch: MessageBatch<ReevalMessage>,
  env: Bindings,
): Promise<void> {
  const weights = loadWeights();
  for (const msg of batch.messages) {
    try {
      const asset = await getAsset(env.DB, msg.body.asset_id);
      if (!asset) {
        msg.ack();
        continue;
      }
      // Re-derive state from persisted attribution signals (source_count etc).
      const conf = scoreConfidence(
        {
          source_count: asset.source_count,
          in_owned_asn: asset.attribution_org_id != null,
        },
        weights,
      );
      if (asset.state !== 'disputed' && conf.state !== asset.state) {
        await setAssetState(env.DB, asset.id, conf.state).run();
      }
      msg.ack();
    } catch {
      msg.retry();
    }
  }
}
