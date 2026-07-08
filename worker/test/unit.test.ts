import { describe, expect, it } from 'vitest';
import { computeProvisionalRating } from '../src/score/provisional.js';
import { buildSlackMessage } from '../src/notify/slack.js';
import type { DiffSummary } from '../src/diff/engine.js';

describe('provisional rating', () => {
  it('rewards a high confirmed ratio and penalizes severe changes', () => {
    const clean = computeProvisionalRating({
      totalAssets: 10,
      confirmedAssets: 10,
      severityCounts: {},
    });
    const noisy = computeProvisionalRating({
      totalAssets: 10,
      confirmedAssets: 4,
      severityCounts: { high: 3, critical: 1 },
    });
    expect(clean.score).toBeGreaterThan(noisy.score);
    expect(clean.grade).toBe('A');
    expect(clean.provisional).toBe(true);
    expect(clean.csf.ID).toBeGreaterThan(noisy.csf.ID);
  });

  it('clamps score to [0,1000]', () => {
    const r = computeProvisionalRating({
      totalAssets: 1,
      confirmedAssets: 0,
      severityCounts: { critical: 100 },
    });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1000);
  });
});

describe('slack message', () => {
  const summary: DiffSummary = {
    domain_id: 'd',
    org_id: 'o',
    added: 2,
    changed: 1,
    removed: 1,
    unchanged: 3,
    bySeverity: { info: 0, low: 1, med: 2, high: 1, critical: 0 },
    changeIds: [],
    touchedAssetIds: [],
  };
  it('renders a block-kit payload with counts', () => {
    const msg = buildSlackMessage({
      orgName: 'ACME',
      fqdn: 'example.com',
      summary,
      detectedAt: '2026-07-08T00:00:00Z',
    }) as { text: string; blocks: unknown[] };
    expect(msg.text).toContain('ACME');
    expect(msg.text).toContain('example.com');
    expect(msg.blocks.length).toBeGreaterThan(0);
  });
});
