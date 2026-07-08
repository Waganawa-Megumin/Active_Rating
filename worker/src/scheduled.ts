// Active Rating — cron handler (design v1.0 §9 scheduled). P1: resend unnotified
// med+ Slack changes; CT/KEV pollers are declared and offline-safe (no-op when
// OFFLINE=1) so later phases can fill them in.

import { severityAtLeast, type Severity } from '@ar/shared';
import type { Bindings } from './env.js';
import { unnotifiedChanges, markNotified } from './db/queries.js';

export async function runScheduled(env: Bindings): Promise<void> {
  await resendUnnotified(env);
  await pollCT(env);
  await pollKEV(env);
}

async function resendUnnotified(env: Bindings): Promise<void> {
  const pending = await unnotifiedChanges(env.DB, 100);
  const immediate = pending.filter((ch) => severityAtLeast(ch.severity as Severity, 'med'));
  if (immediate.length === 0) return;

  if (env.SLACK_ENABLED === '1' && env.SLACK_WEBHOOK_URL) {
    const text = immediate
      .map((ch) => `• ${ch.change_type} ${ch.entity_type} (${ch.severity})`)
      .join('\n');
    try {
      await fetch(env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: `🛰 未通知の変更 ${immediate.length}件\n${text}` }),
      });
    } catch {
      return; // leave unnotified for the next run
    }
  } else {
    console.log('[cron:slack:disabled]', immediate.length, 'pending med+ changes');
  }

  await markNotified(env.DB, immediate.map((c) => c.id)).run();
}

// P2+ event feeds. Offline-safe stubs so cron never fails in local/CI runs.
async function pollCT(env: Bindings): Promise<void> {
  if (env.OFFLINE === '1') return;
  // TODO(P4): poll crt.sh CT stream, enqueue impacted assets for re-eval.
}

async function pollKEV(env: Bindings): Promise<void> {
  if (env.OFFLINE === '1') return;
  // TODO(P4): poll CISA KEV / EPSS, re-score matching product/version assets.
}
