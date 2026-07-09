// Active Rating — Cloudflare Worker entrypoint (design v1.0 §9).
// Routes: /ingest (HMAC), /admin/* (registration), /dispute, /api/* (read).
// Also: scheduled() cron and queue() event-driven re-eval.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings, ReevalMessage } from './env.js';
import { ingestRoute } from './routes/ingest.js';
import { adminRoute } from './routes/admin.js';
import { disputeRoute } from './routes/dispute.js';
import { apiRoute } from './routes/api.js';
import { runScheduled } from './scheduled.js';
import { handleReeval } from './queue.js';

export const app = new Hono<{ Bindings: Bindings }>();

// Dashboard is a separate origin (GitHub Pages / Cloudflare Pages) — allow the
// Authorization bearer from the browser on both read and admin routes.
const corsOpts = {
  allowHeaders: ['authorization', 'content-type', 'x-ar-user'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
};
app.use('/api/*', cors(corsOpts));
app.use('/admin/*', cors(corsOpts));

app.get('/', (c) => c.text('active-rating worker ok'));

app.route('/', ingestRoute);
app.route('/', adminRoute);
app.route('/', disputeRoute);
app.route('/', apiRoute);

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(env));
  },
  async queue(batch: MessageBatch<ReevalMessage>, env: Bindings) {
    await handleReeval(batch, env);
  },
};
