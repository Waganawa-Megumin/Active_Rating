-- Active Rating — integrated D1 (SQLite) schema. Design v1.0 §5.
-- Single authoritative DDL, idempotent (CREATE TABLE IF NOT EXISTS). Phase 1
-- writes to organizations/domains/snapshots/assets/changes/evidence_bundles/
-- disputes/findings; the remaining tables stand ready for P2–P6.

PRAGMA foreign_keys = ON;

-- ===== 組織・資産・差分（基盤 / v0.1-0.2,0.5）=====
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES organizations(id),
  relation_type TEXT NOT NULL CHECK (relation_type IN ('self','subsidiary','supplier','partner','watch')),
  active_confirmed INTEGER NOT NULL DEFAULT 0,
  slack_channel TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  fqdn TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(org_id, fqdn)
);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL REFERENCES domains(id),
  source TEXT NOT NULL,
  profile TEXT NOT NULL,
  run_at TEXT NOT NULL,
  asset_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_snapshots_domain ON snapshots(domain_id, run_at);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,                        -- hash(domain_id||entity_type||identity)
  domain_id TEXT NOT NULL REFERENCES domains(id),
  org_id TEXT NOT NULL REFERENCES organizations(id),
  entity_type TEXT NOT NULL,                  -- subdomain/dns/service/cert/web/exposure/asn/vpn
  identity TEXT NOT NULL,
  attrs_json TEXT NOT NULL,
  -- 確信度・帰属 (v0.2)
  confidence INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'candidate',    -- candidate/confirmed/disputed
  attribution_org_id TEXT REFERENCES organizations(id),
  attribution_conf TEXT NOT NULL DEFAULT 'low',
  source_count INTEGER NOT NULL DEFAULT 1,
  stable_runs INTEGER NOT NULL DEFAULT 0,     -- debounce
  -- 文脈 (v0.5)
  criticality TEXT DEFAULT 'unknown',         -- crown/high/med/low
  data_sensitivity TEXT DEFAULT 'unknown',
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'        -- active/gone
);
CREATE INDEX IF NOT EXISTS idx_assets_domain ON assets(domain_id);
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(entity_type);
CREATE INDEX IF NOT EXISTS idx_assets_org ON assets(org_id, status);

CREATE TABLE IF NOT EXISTS changes (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL REFERENCES domains(id),
  org_id TEXT NOT NULL REFERENCES organizations(id),
  asset_id TEXT,
  entity_type TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('ADDED','REMOVED','CHANGED')),
  severity TEXT NOT NULL DEFAULT 'info',
  before_json TEXT,
  after_json TEXT,
  detected_at TEXT NOT NULL,
  notified INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_changes_org ON changes(org_id, detected_at);
CREATE INDEX IF NOT EXISTS idx_changes_unnotified ON changes(notified, severity);

-- ===== 評価・リスク（v0.2）=====
CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  org_id TEXT NOT NULL REFERENCES organizations(id),
  finding_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  score REAL,
  evidence_json TEXT,
  status TEXT NOT NULL DEFAULT 'new',          -- new/triaged/accepted/in_progress/resolved
  sla_due TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_findings_org ON findings(org_id, severity, status);

CREATE TABLE IF NOT EXISTS baselines (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,                          -- asset:<id> | domain:<id>
  expected_json TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT
);

CREATE TABLE IF NOT EXISTS risk_scores (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,                          -- asset:<id> | org:<id>
  score REAL NOT NULL,
  computed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_risk_scope ON risk_scores(scope, computed_at);

-- ===== VPN（v0.3-0.4）=====
CREATE TABLE IF NOT EXISTS vpn_assets (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id),
  product TEXT, version TEXT, cpe TEXT,
  mfa_state TEXT DEFAULT 'unknown',            -- enforced/conditional/likely-idp/absent/unknown
  eol INTEGER DEFAULT 0, jarm TEXT,
  assess_tier_allowed TEXT DEFAULT 'T1',       -- T0..T3
  last_eval_at TEXT
);
CREATE TABLE IF NOT EXISTS vpn_cve_refs (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  cve TEXT NOT NULL, kev INTEGER NOT NULL DEFAULT 0, epss REAL, cvss REAL,
  verified_by TEXT, detected_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vpncve_asset ON vpn_cve_refs(asset_id, kev);
CREATE TABLE IF NOT EXISTS vpn_cred_exposure (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  source TEXT NOT NULL, identifier TEXT,       -- 生PWは保存しない
  stealer_url_hit INTEGER DEFAULT 0, first_seen TEXT NOT NULL
);

-- ===== アセスメント（v0.4）=====
CREATE TABLE IF NOT EXISTS assessments (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  tier TEXT NOT NULL, roe_ref TEXT, change_ticket TEXT,
  window_start TEXT, window_end TEXT, operator TEXT,
  started_at TEXT NOT NULL, ended_at TEXT
);
CREATE TABLE IF NOT EXISTS assess_results (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessments(id),
  category TEXT NOT NULL,                       -- auth/session/transport/vuln/disclosure/mfa/ux
  test_case TEXT NOT NULL, surface TEXT,        -- pc/mobile/native/-
  result TEXT NOT NULL,                         -- pass/fail/na/needs-review
  severity TEXT, evidence_json TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assessres_cat ON assess_results(category, result);
CREATE TABLE IF NOT EXISTS surface_controls (
  asset_id TEXT NOT NULL REFERENCES assets(id),
  surface TEXT NOT NULL,                        -- pc/mobile/native
  controls_json TEXT NOT NULL, observed_at TEXT NOT NULL,
  PRIMARY KEY (asset_id, surface)
);

-- ===== BitSight・タイムリーさ（v0.5）=====
CREATE TABLE IF NOT EXISTS bitsight_findings (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id),
  asset_ref TEXT, vector TEXT, grade TEXT, detail_json TEXT,
  observed_at TEXT NOT NULL, reconciled TEXT DEFAULT 'pending'  -- matched/gap/attribution_error/stale
);
CREATE TABLE IF NOT EXISTS detection_latency (
  id TEXT PRIMARY KEY,
  finding_id TEXT REFERENCES findings(id),
  trigger TEXT,                                 -- ct/kev/leak/bitsight/scheduled
  event_at TEXT, detected_at TEXT, mttd_sec INTEGER, bitsight_seen_at TEXT
);

-- ===== TI統合・評価（v0.6）=====
CREATE TABLE IF NOT EXISTS ti_enrichment (
  id TEXT PRIMARY KEY,
  indicator TEXT NOT NULL, itype TEXT NOT NULL,
  source TEXT NOT NULL, verdict TEXT, score REAL, actor_json TEXT,
  fetched_at TEXT NOT NULL, ttl_sec INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ti_ind ON ti_enrichment(indicator, itype);
CREATE TABLE IF NOT EXISTS ti_consensus (
  indicator TEXT PRIMARY KEY,
  malicious_sources INTEGER DEFAULT 0, total_sources INTEGER DEFAULT 0,
  confidence TEXT, updated_at TEXT             -- confirmed/suspect/clean
);
CREATE TABLE IF NOT EXISTS framework_scores (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id),
  framework TEXT NOT NULL,                      -- nist_csf/cis/iso27001/meti
  function_or_control TEXT NOT NULL, score REAL NOT NULL,
  evidence_json TEXT, period TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attack_vectors (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id),
  vector TEXT NOT NULL, grade TEXT NOT NULL, score REAL NOT NULL,
  threat_weight REAL, detection_gap INTEGER, trend TEXT, period TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS overall_ratings (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id),
  score REAL NOT NULL, grade TEXT NOT NULL, confidence REAL,
  bitsight_ref REAL, computed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_overall_org ON overall_ratings(org_id, computed_at);
CREATE TABLE IF NOT EXISTS dual_eval (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,                        -- vector:vpn / framework:DE / overall
  claude_json TEXT, openai_json TEXT, deterministic_grade TEXT,
  agreement TEXT,                               -- agree/llm_divergence/rule_divergence
  needs_review INTEGER DEFAULT 0, created_at TEXT NOT NULL
);

-- ===== Active Rating 証跡・可視化（v0.7）=====
CREATE TABLE IF NOT EXISTS evidence_bundles (
  id TEXT PRIMARY KEY,
  finding_id TEXT REFERENCES findings(id),
  asset_id TEXT REFERENCES assets(id),
  change_id TEXT REFERENCES changes(id),
  method TEXT NOT NULL, proof_json TEXT NOT NULL, snapshot_ref TEXT,
  sources_json TEXT, confidence INTEGER, observed_at TEXT NOT NULL, ttl_sec INTEGER
);
CREATE INDEX IF NOT EXISTS idx_evidence_asset ON evidence_bundles(asset_id);
CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  finding_id TEXT REFERENCES findings(id),
  asset_id TEXT REFERENCES assets(id),
  claim TEXT, outcome TEXT,                     -- upheld/retracted/pending
  revalidated_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS geo_points (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id),
  lat REAL, lon REAL, geo_source TEXT,
  attribution TEXT, grade TEXT, criticality TEXT  -- confirmed/estimated ← 色分け根拠
);
CREATE TABLE IF NOT EXISTS threat_arcs (
  id TEXT PRIMARY KEY,
  src_lat REAL, src_lon REAL,
  dst_asset_id TEXT REFERENCES assets(id),
  ti_source TEXT, severity TEXT, observed_at TEXT NOT NULL
);
