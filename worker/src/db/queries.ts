// Active Rating — centralized D1 prepared statements. Reused by the diff engine,
// the admin/registration API, and the read API. Never string-interpolate values.

export interface AssetRow {
  id: string;
  domain_id: string;
  org_id: string;
  entity_type: string;
  identity: string;
  attrs_json: string;
  confidence: number;
  state: string;
  attribution_org_id: string | null;
  attribution_conf: string;
  source_count: number;
  stable_runs: number;
  criticality: string | null;
  data_sensitivity: string | null;
  first_seen: string;
  last_seen: string;
  status: string;
}

export interface OrgRow {
  id: string;
  name: string;
  parent_id: string | null;
  relation_type: string;
  active_confirmed: number;
  slack_channel: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface DomainRow {
  id: string;
  org_id: string;
  fqdn: string;
  enabled: number;
  created_at: string;
}

export interface ChangeRow {
  id: string;
  domain_id: string;
  org_id: string;
  asset_id: string | null;
  entity_type: string;
  change_type: string;
  severity: string;
  before_json: string | null;
  after_json: string | null;
  detected_at: string;
  notified: number;
}

// ---- organizations ----

export function upsertOrg(db: D1Database, row: OrgRow) {
  return db
    .prepare(
      `INSERT INTO organizations (id, name, parent_id, relation_type, active_confirmed, slack_channel, notes, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, parent_id=excluded.parent_id, relation_type=excluded.relation_type,
         active_confirmed=excluded.active_confirmed, slack_channel=excluded.slack_channel,
         notes=excluded.notes, updated_at=excluded.updated_at`,
    )
    .bind(
      row.id,
      row.name,
      row.parent_id,
      row.relation_type,
      row.active_confirmed,
      row.slack_channel,
      row.notes,
      row.created_at,
      row.updated_at,
    );
}

export async function findOrgByName(db: D1Database, name: string): Promise<OrgRow | null> {
  return db.prepare(`SELECT * FROM organizations WHERE name = ?1`).bind(name).first<OrgRow>();
}

export async function listOrgs(db: D1Database): Promise<OrgRow[]> {
  const res = await db.prepare(`SELECT * FROM organizations ORDER BY created_at`).all<OrgRow>();
  return res.results ?? [];
}

export async function deleteOrg(db: D1Database, id: string) {
  return db.prepare(`DELETE FROM organizations WHERE id = ?1`).bind(id).run();
}

// ---- domains ----

export function upsertDomain(db: D1Database, row: DomainRow) {
  return db
    .prepare(
      `INSERT INTO domains (id, org_id, fqdn, enabled, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(org_id, fqdn) DO UPDATE SET enabled=excluded.enabled`,
    )
    .bind(row.id, row.org_id, row.fqdn, row.enabled, row.created_at);
}

export async function findDomain(
  db: D1Database,
  org_id: string,
  fqdn: string,
): Promise<DomainRow | null> {
  return db
    .prepare(`SELECT * FROM domains WHERE org_id = ?1 AND fqdn = ?2`)
    .bind(org_id, fqdn)
    .first<DomainRow>();
}

export async function getDomain(db: D1Database, id: string): Promise<DomainRow | null> {
  return db.prepare(`SELECT * FROM domains WHERE id = ?1`).bind(id).first<DomainRow>();
}

export async function deleteDomain(db: D1Database, id: string) {
  return db.prepare(`DELETE FROM domains WHERE id = ?1`).bind(id).run();
}

/** Enrollment view: enabled domains joined with their org for the scanner. */
export async function listEnrollment(db: D1Database) {
  const res = await db
    .prepare(
      `SELECT d.id AS domain_id, d.org_id AS organization_id, d.fqdn,
              o.relation_type, o.active_confirmed, o.slack_channel
       FROM domains d JOIN organizations o ON o.id = d.org_id
       WHERE d.enabled = 1
       ORDER BY o.name, d.fqdn`,
    )
    .all();
  return res.results ?? [];
}

// ---- assets ----

export async function priorAssets(
  db: D1Database,
  domain_id: string,
  entity_type: string,
): Promise<AssetRow[]> {
  const res = await db
    .prepare(
      `SELECT * FROM assets WHERE domain_id = ?1 AND entity_type = ?2 AND status = 'active'`,
    )
    .bind(domain_id, entity_type)
    .all<AssetRow>();
  return res.results ?? [];
}

export function upsertAsset(db: D1Database, a: AssetRow) {
  return db
    .prepare(
      `INSERT INTO assets (id, domain_id, org_id, entity_type, identity, attrs_json,
         confidence, state, attribution_org_id, attribution_conf, source_count, stable_runs,
         criticality, data_sensitivity, first_seen, last_seen, status)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)
       ON CONFLICT(id) DO UPDATE SET
         attrs_json=excluded.attrs_json, confidence=excluded.confidence, state=excluded.state,
         source_count=excluded.source_count, stable_runs=excluded.stable_runs,
         last_seen=excluded.last_seen, status='active'`,
    )
    .bind(
      a.id, a.domain_id, a.org_id, a.entity_type, a.identity, a.attrs_json,
      a.confidence, a.state, a.attribution_org_id, a.attribution_conf, a.source_count, a.stable_runs,
      a.criticality, a.data_sensitivity, a.first_seen, a.last_seen, a.status,
    );
}

export function touchAsset(db: D1Database, id: string, last_seen: string) {
  return db
    .prepare(`UPDATE assets SET last_seen=?2, stable_runs=stable_runs+1, status='active' WHERE id=?1`)
    .bind(id, last_seen);
}

export function markAssetGone(db: D1Database, id: string, last_seen: string) {
  return db
    .prepare(`UPDATE assets SET status='gone', last_seen=?2 WHERE id=?1`)
    .bind(id, last_seen);
}

export function setAssetState(db: D1Database, id: string, state: string) {
  return db.prepare(`UPDATE assets SET state=?2 WHERE id=?1`).bind(id, state);
}

export async function getAsset(db: D1Database, id: string): Promise<AssetRow | null> {
  return db.prepare(`SELECT * FROM assets WHERE id = ?1`).bind(id).first<AssetRow>();
}

export async function listAssets(db: D1Database, limit = 500): Promise<AssetRow[]> {
  const res = await db
    .prepare(`SELECT * FROM assets ORDER BY last_seen DESC LIMIT ?1`)
    .bind(limit)
    .all<AssetRow>();
  return res.results ?? [];
}

export function tagAsset(
  db: D1Database,
  id: string,
  criticality: string | null,
  data_sensitivity: string | null,
) {
  return db
    .prepare(
      `UPDATE assets SET criticality=COALESCE(?2, criticality), data_sensitivity=COALESCE(?3, data_sensitivity) WHERE id=?1`,
    )
    .bind(id, criticality, data_sensitivity);
}

// ---- changes ----

export function insertChange(db: D1Database, c: ChangeRow) {
  return db
    .prepare(
      `INSERT INTO changes (id, domain_id, org_id, asset_id, entity_type, change_type, severity, before_json, after_json, detected_at, notified)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`,
    )
    .bind(
      c.id, c.domain_id, c.org_id, c.asset_id, c.entity_type, c.change_type,
      c.severity, c.before_json, c.after_json, c.detected_at, c.notified,
    );
}

export async function recentChanges(db: D1Database, limit = 200): Promise<ChangeRow[]> {
  const res = await db
    .prepare(`SELECT * FROM changes ORDER BY detected_at DESC LIMIT ?1`)
    .bind(limit)
    .all<ChangeRow>();
  return res.results ?? [];
}

export async function unnotifiedChanges(db: D1Database, limit = 100): Promise<ChangeRow[]> {
  const res = await db
    .prepare(`SELECT * FROM changes WHERE notified = 0 ORDER BY detected_at DESC LIMIT ?1`)
    .bind(limit)
    .all<ChangeRow>();
  return res.results ?? [];
}

export function markNotified(db: D1Database, ids: string[]) {
  const placeholders = ids.map((_, i) => `?${i + 1}`).join(',');
  return db.prepare(`UPDATE changes SET notified = 1 WHERE id IN (${placeholders})`).bind(...ids);
}

// ---- snapshots ----

export function insertSnapshot(
  db: D1Database,
  row: { id: string; domain_id: string; source: string; profile: string; run_at: string; asset_count: number },
) {
  return db
    .prepare(
      `INSERT INTO snapshots (id, domain_id, source, profile, run_at, asset_count)
       VALUES (?1,?2,?3,?4,?5,?6)`,
    )
    .bind(row.id, row.domain_id, row.source, row.profile, row.run_at, row.asset_count);
}

// ---- evidence & disputes ----

export function insertEvidence(
  db: D1Database,
  row: {
    id: string;
    finding_id: string | null;
    asset_id: string | null;
    change_id: string | null;
    method: string;
    proof_json: string;
    snapshot_ref: string | null;
    sources_json: string | null;
    confidence: number | null;
    observed_at: string;
    ttl_sec: number | null;
  },
) {
  return db
    .prepare(
      `INSERT INTO evidence_bundles (id, finding_id, asset_id, change_id, method, proof_json, snapshot_ref, sources_json, confidence, observed_at, ttl_sec)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`,
    )
    .bind(
      row.id, row.finding_id, row.asset_id, row.change_id, row.method, row.proof_json,
      row.snapshot_ref, row.sources_json, row.confidence, row.observed_at, row.ttl_sec,
    );
}

export async function evidenceForAsset(db: D1Database, asset_id: string) {
  const res = await db
    .prepare(`SELECT * FROM evidence_bundles WHERE asset_id = ?1 ORDER BY observed_at DESC LIMIT 50`)
    .bind(asset_id)
    .all();
  return res.results ?? [];
}

export async function getEvidence(db: D1Database, id: string) {
  return db.prepare(`SELECT * FROM evidence_bundles WHERE id = ?1`).bind(id).first();
}

export function insertDispute(
  db: D1Database,
  row: {
    id: string;
    finding_id: string | null;
    asset_id: string | null;
    claim: string | null;
    outcome: string;
    revalidated_at: string | null;
    created_at: string;
  },
) {
  return db
    .prepare(
      `INSERT INTO disputes (id, finding_id, asset_id, claim, outcome, revalidated_at, created_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7)`,
    )
    .bind(row.id, row.finding_id, row.asset_id, row.claim, row.outcome, row.revalidated_at, row.created_at);
}

export async function listDisputes(db: D1Database, limit = 100) {
  const res = await db
    .prepare(`SELECT * FROM disputes ORDER BY created_at DESC LIMIT ?1`)
    .bind(limit)
    .all();
  return res.results ?? [];
}

/** FP-rate KPI: retracted / total resolved disputes. */
export async function disputeStats(db: D1Database) {
  const row = await db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN outcome='retracted' THEN 1 ELSE 0 END) AS retracted,
         SUM(CASE WHEN outcome='upheld' THEN 1 ELSE 0 END) AS upheld
       FROM disputes`,
    )
    .first<{ total: number; retracted: number; upheld: number }>();
  return row ?? { total: 0, retracted: 0, upheld: 0 };
}

/** Simple org-level asset counts used by the rating aggregate. */
export async function orgAssetSummary(db: D1Database, org_id: string) {
  const res = await db
    .prepare(
      `SELECT entity_type, COUNT(*) AS n,
              SUM(CASE WHEN state='confirmed' THEN 1 ELSE 0 END) AS confirmed
       FROM assets WHERE org_id = ?1 AND status='active' GROUP BY entity_type`,
    )
    .bind(org_id)
    .all<{ entity_type: string; n: number; confirmed: number }>();
  return res.results ?? [];
}

export async function orgSeveritySummary(db: D1Database, org_id: string) {
  const res = await db
    .prepare(
      `SELECT severity, COUNT(*) AS n FROM changes WHERE org_id = ?1 GROUP BY severity`,
    )
    .bind(org_id)
    .all<{ severity: string; n: number }>();
  return res.results ?? [];
}
