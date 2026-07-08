// Active Rating — Slack notification (design v0.1 §9). Batches a scan's changes
// into one Block Kit message; med+ immediate. Respects SLACK_ENABLED so local
// runs never touch the network (payload is logged instead).

import { severityAtLeast, type Severity } from '@ar/shared';
import type { Bindings } from '../env.js';
import type { DiffSummary } from '../diff/engine.js';

const SEV_EMOJI: Record<Severity, string> = {
  info: 'ℹ️',
  low: '⚪',
  med: '🟡',
  high: '🔴',
  critical: '🟣',
};

export function buildSlackMessage(opts: {
  orgName: string;
  fqdn: string;
  summary: DiffSummary;
  detectedAt: string;
}): unknown {
  const { summary } = opts;
  const lines: string[] = [];
  if (summary.added) lines.push(`🆕 追加 ${summary.added}`);
  if (summary.changed) lines.push(`🔁 変更 ${summary.changed}`);
  if (summary.removed) lines.push(`🗑 削除 ${summary.removed}`);

  const sevLine = (Object.keys(summary.bySeverity) as Severity[])
    .filter((s) => summary.bySeverity[s] > 0)
    .map((s) => `${SEV_EMOJI[s]} ${s}:${summary.bySeverity[s]}`)
    .join('  ');

  return {
    text: `🛰 [${opts.orgName}] ${opts.fqdn} — 追加${summary.added}/変更${summary.changed}/削除${summary.removed}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🛰 *[${opts.orgName}] ${opts.fqdn}*\n${lines.join('  ') || '変更なし'}`,
        },
      },
      ...(sevLine
        ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: sevLine }] }]
        : []),
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `🕐 ${opts.detectedAt}` }],
      },
    ],
  };
}

/**
 * Send a Slack message if enabled and there is something worth reporting
 * (any med+ change, or any change at all when only low/info). Returns true if a
 * network send was attempted.
 */
export async function notifySlack(
  env: Bindings,
  webhookUrl: string | undefined,
  message: unknown,
  summary: DiffSummary,
): Promise<boolean> {
  const hasChanges = summary.added + summary.changed + summary.removed > 0;
  if (!hasChanges) return false;

  const enabled = env.SLACK_ENABLED === '1' && !!webhookUrl;
  if (!enabled) {
    // Local / disabled: log the payload instead of sending (no network).
    console.log('[slack:disabled]', JSON.stringify(message));
    return false;
  }

  // Immediate only for med+; low/info are left for the daily summary (cron).
  const hasImmediate = (Object.keys(summary.bySeverity) as Severity[]).some(
    (s) => severityAtLeast(s, 'med') && summary.bySeverity[s] > 0,
  );
  if (!hasImmediate) return false;

  try {
    await fetch(webhookUrl!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(message),
    });
    return true;
  } catch (err) {
    console.error('[slack:error]', String(err));
    return false;
  }
}
