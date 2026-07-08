// Active Rating — deploy-time confidence weight override. The engine reads
// weights from config (never hardcoded); this loads worker/weights.json over the
// shared defaults.

import { loadWeights, type ConfidenceWeights } from '@ar/shared';
import override from '../weights.json';
import type { Bindings } from './env.js';

let cached: ConfidenceWeights | null = null;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function loadWorkerWeights(_env: Bindings): Promise<ConfidenceWeights> {
  if (!cached) cached = loadWeights(override as Parameters<typeof loadWeights>[0]);
  return cached;
}
