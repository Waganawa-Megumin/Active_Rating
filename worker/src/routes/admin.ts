// Active Rating — Admin API for the target-asset REGISTRATION system (Phase 1).
// Bearer-token auth (ADMIN_TOKEN). Manages the organization tree + seed domains
// and enforces the active_confirmed approval gate.

import { Hono } from 'hono';
import { ulid } from 'ulidx';
import {
  OrgUpsertSchema,
  DomainUpsertSchema,
  AssetTagSchema,
  timingSafeEqualHex,
} from '@ar/shared';
import type { Bindings } from '../env.js';
import {
  upsertOrg,
  findOrgByName,
  listOrgs,
  upsertDomain,
  findDomain,
  tagAsset,
  orgChildCount,
  deleteOrgCascadeStmts,
  deleteDomainCascadeStmts,
  type OrgRow,
} from '../db/queries.js';

export const adminRoute = new Hono<{ Bindings: Bindings }>();

// Bearer-token guard for every /admin/* route.
adminRoute.use('/admin/*', async (c, next) => {
  const auth = c.req.header('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const expected = c.env.ADMIN_TOKEN ?? '';
  // Compare hex-encoded lengths in constant time by encoding to hex first.
  const toHex = (s: string) => Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('');
  if (!expected || !timingSafeEqualHex(toHex(token), toHex(expected))) {
    return c.text('unauthorized', 401);
  }
  await next();
});

function nowIso(): string {
  return new Date().toISOString();
}

// ---- organizations ----

adminRoute.get('/admin/orgs', async (c) => {
  return c.json(await listOrgs(c.env.DB));
});

adminRoute.post('/admin/orgs', async (c) => {
  const parsed = OrgUpsertSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'validation', issues: parsed.error.issues }, 422);
  const d = parsed.data;

  // Idempotent by id, else by name (register CLI upserts by stable name).
  const existing = d.id
    ? null
    : await findOrgByName(c.env.DB, d.name);
  const id = d.id ?? existing?.id ?? ulid();

  const row: OrgRow = {
    id,
    name: d.name,
    parent_id: d.parent_id ?? null,
    relation_type: d.relation_type,
    active_confirmed: d.active_confirmed ? 1 : 0,
    slack_channel: d.slack_channel ?? null,
    // Audit the approval gate: record who/when active was granted.
    notes:
      d.active_confirmed && d.relation_type !== 'self'
        ? `${d.notes ?? ''}\n[active_confirmed granted via admin API @ ${nowIso()}]`.trim()
        : d.notes ?? null,
    created_at: existing?.created_at ?? nowIso(),
    updated_at: nowIso(),
  };
  await upsertOrg(c.env.DB, row).run();
  return c.json({ ok: true, id, relation_type: row.relation_type, active_confirmed: !!row.active_confirmed });
});

adminRoute.delete('/admin/orgs/:id', async (c) => {
  const id = c.req.param('id');
  const children = await orgChildCount(c.env.DB, id);
  await c.env.DB.batch(deleteOrgCascadeStmts(c.env.DB, id));
  return c.json({ ok: true, reparented_children: children });
});

// ---- domains ----

adminRoute.post('/admin/domains', async (c) => {
  const parsed = DomainUpsertSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'validation', issues: parsed.error.issues }, 422);
  const d = parsed.data;

  const existing = await findDomain(c.env.DB, d.org_id, d.fqdn);
  const id = d.id ?? existing?.id ?? ulid();
  await upsertDomain(c.env.DB, {
    id,
    org_id: d.org_id,
    fqdn: d.fqdn.trim().toLowerCase().replace(/\.$/, ''),
    enabled: d.enabled ? 1 : 0,
    created_at: existing?.created_at ?? nowIso(),
  }).run();
  return c.json({ ok: true, id });
});

adminRoute.delete('/admin/domains/:id', async (c) => {
  await c.env.DB.batch(deleteDomainCascadeStmts(c.env.DB, c.req.param('id')));
  return c.json({ ok: true });
});

// ---- forward-looking: per-asset context tags (criticality / crown-jewel) ----

adminRoute.post('/admin/assets/tags', async (c) => {
  const parsed = AssetTagSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'validation', issues: parsed.error.issues }, 422);
  const d = parsed.data;
  await tagAsset(c.env.DB, d.asset_id, d.criticality ?? null, d.data_sensitivity ?? null).run();
  return c.json({ ok: true });
});
