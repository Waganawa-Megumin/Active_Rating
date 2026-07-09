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

export async function listAllDomains(db: D1Database): Promise<DomainRow[]> {
  const res = await db.prepare(`SELECT * FROM domains ORDER BY fqdn`).all<DomainRow>();
  return res.results ?? [];
}

export async function orgChildCount(db: D1Database, id: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM organizations WHERE parent_id = ?1`)
    .bind(id)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/** Cascade-delete a domain and all data derived from it (FK-independent). */
export function deleteDomainCascadeStmts(db: D1Database, id: string): D1PreparedStatement[] {
  const p = (sql: string) => db.prepare(sql).bind(id);
  return [
    p(`DELETE FROM evidence_bundles WHERE asset_id IN (SELECT id FROM assets WHERE domain_id = ?1)`),
    p(`DELETE FROM evidence_bundles WHERE change_id IN (SELECT id FROM changes WHERE domain_id = ?1)`),
    p(`DELETE FROM findings WHERE asset_id IN (SELECT id FROM assets WHERE domain_id = ?1)`),
    p(`DELETE FROM disputes WHERE asset_id IN (SELECT id FROM assets WHERE domain_id = ?1)`),
    p(`DELETE FROM changes WHERE domain_id = ?1`),
    p(`DELETE FROM assets WHERE domain_id = ?1`),
    p(`DELETE FROM snapshots WHERE domain_id = ?1`),
    p(`DELETE FROM domains WHERE id = ?1`),
  ];
}

/**
 * Cascade-delete an org and everything under it (domains + scan data + scores).
 * Child orgs are reparented to this org's parent so they are not orphaned.
 */
export function deleteOrgCascadeStmts(db: D1Database, id: string): D1PreparedStatement[] {
  const p = (sql: string) => db.prepare(sql).bind(id);
  return [
    p(`UPDATE organizations SET parent_id = (SELECT parent_id FROM organizations WHERE id = ?1) WHERE parent_id = ?1`),
    p(`DELETE FROM evidence_bundles WHERE asset_id IN (SELECT id FROM assets WHERE org_id = ?1)`),
    p(`DELETE FROM evidence_bundles WHERE change_id IN (SELECT id FROM changes WHERE org_id = ?1)`),
    p(`DELETE FROM findings WHERE org_id = ?1`),
    p(`DELETE FROM disputes WHERE asset_id IN (SELECT id FROM assets WHERE org_id = ?1)`),
    p(`DELETE FROM changes WHERE org_id = ?1`),
    p(`DELETE FROM assets WHERE org_id = ?1`),
    p(`DELETE FROM snapshots WHERE domain_id IN (SELECT id FROM domains WHERE org_id = ?1)`),
    p(`DELETE FROM domains WHERE org_id = ?1`),
    p(`DELETE FROM overall_ratings WHERE org_id = ?1`),
    p(`DELETE FROM framework_scores WHERE org_id = ?1`),
    p(`DELETE FROM attack_vectors WHERE org_id = ?1`),
    p(`DELETE FROM bitsight_findings WHERE org_id = ?1`),
    p(`DELETE FROM organizations WHERE id = ?1`),
  ];
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

// ---- findings + scoring (deterministic evaluation) ----

export async function activeAssetsForOrg(
  db: D1Database,
  org_id: string,
): Promise<Array<{ id: string; entity_type: string; attrs_json: string; state: string }>> {
  const res = await db
    .prepare(
      `SELECT id, entity_type, attrs_json, state FROM assets WHERE org_id = ?1 AND status='active'`,
    )
    .bind(org_id)
    .all<{ id: string; entity_type: string; attrs_json: string; state: string }>();
  return res.results ?? [];
}

export function upsertFinding(
  db: D1Database,
  f: {
    id: string;
    asset_id: string;
    org_id: string;
    finding_type: string;
    severity: string;
    score: number;
    evidence_json: string | null;
    sla_due: string | null;
    first_seen: string;
    last_seen: string;
  },
) {
  return db
    .prepare(
      `INSERT INTO findings (id, asset_id, org_id, finding_type, severity, score, evidence_json, status, sla_due, first_seen, last_seen)
       VALUES (?1,?2,?3,?4,?5,?6,?7,'new',?8,?9,?10)
       ON CONFLICT(id) DO UPDATE SET
         severity=excluded.severity, score=excluded.score, sla_due=excluded.sla_due,
         last_seen=excluded.last_seen,
         status=CASE WHEN findings.status='resolved' THEN 'new' ELSE findings.status END,
         resolved_at=CASE WHEN findings.status='resolved' THEN NULL ELSE findings.resolved_at END`,
    )
    .bind(
      f.id, f.asset_id, f.org_id, f.finding_type, f.severity, f.score, f.evidence_json,
      f.sla_due, f.first_seen, f.last_seen,
    );
}

export function resolveFindingsNotIn(
  db: D1Database,
  org_id: string,
  keepIds: string[],
  now: string,
) {
  if (keepIds.length === 0) {
    return db
      .prepare(`UPDATE findings SET status='resolved', resolved_at=?2 WHERE org_id=?1 AND status!='resolved'`)
      .bind(org_id, now);
  }
  const ph = keepIds.map((_, i) => `?${i + 3}`).join(',');
  return db
    .prepare(
      `UPDATE findings SET status='resolved', resolved_at=?2 WHERE org_id=?1 AND status!='resolved' AND id NOT IN (${ph})`,
    )
    .bind(org_id, now, ...keepIds);
}

const SEV_RANK_SQL = `CASE severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'med' THEN 2 WHEN 'low' THEN 1 ELSE 0 END`;

export async function listFindings(db: D1Database, org_id: string | null, limit = 100) {
  const sql =
    `SELECT f.id, f.asset_id, f.org_id, f.finding_type, f.severity, f.score, f.status, f.sla_due,
            f.first_seen, f.last_seen, a.identity AS asset_identity, a.entity_type AS asset_entity_type
     FROM findings f JOIN assets a ON a.id = f.asset_id
     WHERE f.status != 'resolved'` +
    (org_id ? ` AND f.org_id = ?2` : '') +
    ` ORDER BY ${SEV_RANK_SQL} DESC, f.sla_due ASC LIMIT ?1`;
  const stmt = org_id
    ? db.prepare(sql).bind(limit, org_id)
    : db.prepare(sql).bind(limit);
  const res = await stmt.all();
  return res.results ?? [];
}

export function replaceVectorsStmts(
  db: D1Database,
  org_id: string,
  period: string,
  rows: Array<{ vector: string; grade: string; score: number }>,
): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM attack_vectors WHERE org_id = ?1`).bind(org_id),
  ];
  for (const r of rows) {
    out.push(
      db
        .prepare(
          `INSERT INTO attack_vectors (id, org_id, vector, grade, score, period) VALUES (?1,?2,?3,?4,?5,?6)`,
        )
        .bind(`${org_id}:${r.vector}`, org_id, r.vector, r.grade, r.score, period),
    );
  }
  return out;
}

export function replaceFrameworkStmts(
  db: D1Database,
  org_id: string,
  period: string,
  csf: Record<string, number>,
): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM framework_scores WHERE org_id = ?1 AND framework='nist_csf'`).bind(org_id),
  ];
  for (const [fn, score] of Object.entries(csf)) {
    out.push(
      db
        .prepare(
          `INSERT INTO framework_scores (id, org_id, framework, function_or_control, score, period) VALUES (?1,?2,'nist_csf',?3,?4,?5)`,
        )
        .bind(`${org_id}:nist_csf:${fn}`, org_id, fn, score, period),
    );
  }
  return out;
}

export function insertOverall(
  db: D1Database,
  row: { id: string; org_id: string; score: number; grade: string; confidence: number; computed_at: string },
) {
  return db
    .prepare(
      `INSERT INTO overall_ratings (id, org_id, score, grade, confidence, computed_at) VALUES (?1,?2,?3,?4,?5,?6)`,
    )
    .bind(row.id, row.org_id, row.score, row.grade, row.confidence, row.computed_at);
}

export async function latestOveralls(db: D1Database, org_id: string, n = 2) {
  const res = await db
    .prepare(`SELECT score, grade, confidence, computed_at FROM overall_ratings WHERE org_id=?1 ORDER BY computed_at DESC LIMIT ?2`)
    .bind(org_id, n)
    .all<{ score: number; grade: string; confidence: number; computed_at: string }>();
  return res.results ?? [];
}

export async function listVectors(db: D1Database, org_id: string) {
  const res = await db
    .prepare(`SELECT vector, grade, score FROM attack_vectors WHERE org_id=?1`)
    .bind(org_id)
    .all<{ vector: string; grade: string; score: number }>();
  return res.results ?? [];
}

export async function listFrameworkCsf(db: D1Database, org_id: string) {
  const res = await db
    .prepare(`SELECT function_or_control, score FROM framework_scores WHERE org_id=?1 AND framework='nist_csf'`)
    .bind(org_id)
    .all<{ function_or_control: string; score: number }>();
  return res.results ?? [];
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
