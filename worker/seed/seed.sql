-- GENERATED baseline seed (gen_seed.mjs). Orgs + domains + baseline example.com assets.
-- Registration is normally done via the Admin API / register CLI; this seed lets
-- the local pipeline resolve org_id + show a populated dashboard before any scan.
PRAGMA foreign_keys = ON;

DELETE FROM changes; DELETE FROM evidence_bundles; DELETE FROM snapshots; DELETE FROM assets; DELETE FROM domains; DELETE FROM organizations;

INSERT INTO organizations (id, name, parent_id, relation_type, active_confirmed, slack_channel, notes, created_at) VALUES
 ('org-acme','ACME Holdings',NULL,'self',1,'#asm-acme','親会社（自組織）。能動スキャン許可済み。','2026-07-01T00:00:00.000Z'),
 ('org-subx','ACME Subsidiary X','org-acme','subsidiary',1,'#asm-sub-x','100%子会社。オーナーシップ確認済み。','2026-07-01T00:00:00.000Z'),
 ('org-suppliery','Supplier Y','org-acme','supplier',0,NULL,'サプライチェーン。受動観測のみ。','2026-07-01T00:00:00.000Z');

INSERT INTO domains (id, org_id, fqdn, enabled, created_at) VALUES
 ('dom-example','org-acme','example.com',1,'2026-07-01T00:00:00.000Z'),
 ('dom-subx','org-subx','sub-x.example.net',1,'2026-07-01T00:00:00.000Z'),
 ('dom-suppliery','org-suppliery','supplier-y.example.org',1,'2026-07-01T00:00:00.000Z');

INSERT INTO snapshots (id, domain_id, source, profile, run_at, asset_count) VALUES
 ('snap-baseline','dom-example','seed','active','2026-07-01T00:00:00.000Z',4);

INSERT INTO assets (id, domain_id, org_id, entity_type, identity, attrs_json, confidence, state, attribution_org_id, attribution_conf, source_count, stable_runs, criticality, data_sensitivity, first_seen, last_seen, status) VALUES ('5c1f27030c3509326b0ee9d94d5ea371a22818b89370bce45d601854ef913e62', 'dom-example', 'org-acme', 'subdomain', 'www.example.com', '{"a":["203.0.113.10"],"resolves":true}', 60, 'confirmed', 'org-acme', 'med', 2, 3, 'high', 'unknown', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', 'active');
INSERT INTO assets (id, domain_id, org_id, entity_type, identity, attrs_json, confidence, state, attribution_org_id, attribution_conf, source_count, stable_runs, criticality, data_sensitivity, first_seen, last_seen, status) VALUES ('1d29404ee416793377c411da292951117a95db8f7171cdd00f55e84494ba0e75', 'dom-example', 'org-acme', 'subdomain', 'api.example.com', '{"a":["203.0.113.20"],"resolves":true}', 60, 'confirmed', 'org-acme', 'med', 2, 3, 'high', 'unknown', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', 'active');
INSERT INTO assets (id, domain_id, org_id, entity_type, identity, attrs_json, confidence, state, attribution_org_id, attribution_conf, source_count, stable_runs, criticality, data_sensitivity, first_seen, last_seen, status) VALUES ('32d784ead351c3990ca429c8e64671e1236b9bc865ddf93fcd260423d6ecb5c0', 'dom-example', 'org-acme', 'subdomain', 'mail.example.com', '{"a":["203.0.113.30"],"mx":true,"resolves":true}', 60, 'confirmed', 'org-acme', 'med', 2, 3, 'high', 'unknown', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', 'active');
INSERT INTO assets (id, domain_id, org_id, entity_type, identity, attrs_json, confidence, state, attribution_org_id, attribution_conf, source_count, stable_runs, criticality, data_sensitivity, first_seen, last_seen, status) VALUES ('ebf2997bc5bfd5e52d6af7752e08e0dc9383d471b8f033c0bd7acb70d1605841', 'dom-example', 'org-acme', 'subdomain', 'old.example.com', '{"a":["203.0.113.99"],"resolves":true}', 60, 'confirmed', 'org-acme', 'med', 2, 3, 'high', 'unknown', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', 'active');
