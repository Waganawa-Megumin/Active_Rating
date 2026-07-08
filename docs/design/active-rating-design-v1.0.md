# Active Rating — 統合設計書 v1.0

> 能動検証で裏取りした、反証に耐えるアタックサーフェス評価プラットフォーム。
> 受動的で誤りだらけの Security Rating を、証跡主義で置き換える。

無料枠（GitHub free / Cloudflare free）+ 保有TI/評価APIで構築するマルチテナントASM。
本書は v0.1〜v0.7 を統合した **Claude Code 引き渡し用マスター仕様**。詳細な設計背景は各分冊参照。

---

## 目次
1. 製品概要と原則
2. 全体アーキテクチャ
3. スコープとスキャンプロファイル
4. サブシステム要約（発見→評価→魅せる）
5. 統合データモデル（全DDL）
6. 列挙・辞書（finding_type / vector / framework / TIソース）
7. APIコスト階層
8. ディレクトリ構成
9. 主要スケルトン
10. ロードマップ（フェーズ）
11. 用語集
12. 全体の未決事項

---

## 1. 製品概要と原則

### 1.1 解く痛み
悪質/低品質ASMの「嘘の情報を突きつけられ、整理と反論に疲弊する」を無くす。

### 1.2 4つの設計原則
| 原則 | 実装 |
|---|---|
| **証跡主義** 証跡なき評価を出さない | evidence_bundle 必須、urlscan魚拓、confidence未達は不採用 |
| **能動検証** 推測でなく裏取り | active resolve/probe、帰属検証(ASN/cert/whois) |
| **タイムリー** イベント駆動 | CT/KEV/漏洩で影響資産のみ即時再評価 |
| **気の利き** 文脈で優先 | crown-jewel加重・多因子相関・脅威駆動 |

### 1.3 差別化（vs BitSight等）
深さ（認証あり検証・VPN深掘り）／即時性（MTTD計測）／文脈（相関）／継続（資産単位＋SLA）／
**反証モードとFP率公開**で「正確さ」を数値で主張。

---

## 2. 全体アーキテクチャ

```
┌───────────────────────── GitHub Actions（重いスキャン） ─────────────────────────┐
│ 組織ツリー走査 → profile(active/passive)決定 → 多技法発見・深掘り・アセスメント     │
│ 正規化スナップショットJSON生成 → POST /ingest(HMAC)                                │
└───────────────┬─────────────────────────────────────────────────────────────────┘
                │
┌───────────────▼───────────── Cloudflare Workers（API/評価/通知） ─────────────────┐
│ /ingest  差分計算→changes→assets更新→evidence_bundle                              │
│ 評価     確信度/帰属 → TIエンリッチ(相互確認) → framework/vector/overall スコア     │
│ ダブルLLM Claude+OpenAI 独立評価→reconcile→confidence                             │
│ cron/queue  CT/KEV/EPSS/漏洩/BitSight を監視→影響資産のみ即時再評価(MTTD計測)       │
│ /api/*   read-only（ダッシュボード）   通知→Slack                                  │
└──────┬───────────────────────────────────────┬───────────────────────────────────┘
       │ D1(構造化: assets/findings/ratings/geo) │ R2(RAW結果・証跡スクショ)
       ▼                                        ▼
┌────────────────── Cloudflare Pages（可視化, Cloudflare Access保護） ───────────────┐
│ 3D地球儀(globe.gl) ／ 世界地図(MapLibre) ／ Active Ratingゲージ ／ CSFレーダー       │
│ ベクター信号盤 ／ アタックパスグラフ ／ MTTDレース ／ 反証モード ／ 技術ドリルダウン │
└───────────────────────────────────────────────────────────────────────────────────┘

外部: TI/評価API(VT・GTI・RF・Intel471・CYFIRMA・ThreatVision・SOC Prime・DomainTools・
       DNSLytics・Shodan・urlscan・AbuseIPDB・MaxMind・BitSight) / OpenAI / Anthropic
```

---

## 3. スコープとスキャンプロファイル

組織ツリー: `organizations` 自己参照（親会社→子会社→サプライチェーン→監視他社）。

| relation_type | プロファイル | 手法 |
|---|---|---|
| self / subsidiary（100%保有・active_confirmed） | **active** | 全手法（能動DNS/httpx/ポート・アセスメントT1-T3） |
| supplier / partner / watch | **passive** | CT/IntelX/TI照会/評判のみ。能動スキャン禁止 |

- 所有が曖昧な資産は passive にフォールバック。
- アセスメント成熟度: T0受動 / T1非侵襲能動 / T2認証あり(テストID) / T3侵襲的実証(RoE+変更番号+保守窓)。

---

## 4. サブシステム要約

### 4.1 発見（深さ / v0.2）
シード拡張(whois/cert Org/favicon hash/解析タグ/ASN pivot) → 多技法サブドメイン列挙(passive+brute+permutation+recursive) → **wildcard処理** → 解決/生存 → netblock掃引(PTR/ポート) → deep web(katana/JS抽出) → クラウド/コード露出。

### 4.2 正確さ（確信度・帰属 / v0.2）
confidence = f(独立ソース数, 能動解決, 自社ASN内, cert Org一致, not-wildcard) − 減点(パーキング/共有CDN)。
confirmed/candidate 分離、独立2ソース以上で昇格。帰属は ASN/cert/whois で org 確定、共有CDNは帰属保留。debounce（N回連続で severity 確定）。

### 4.3 継続評価（v0.2）
takeover / nuclei / TLS / baseline drift / secret / 鮮度。findings（SLA付ライフサイクル）＋ risk_scores（時系列, 組織ツリー集約）。

### 4.4 VPN深掘り（v0.3）
指紋(favicon/パス/JARM)→版特定→CVE照合(KEV/EPSS優先)→クレデンシャル相関(IntelX/HIBP/スティーラー)→設定不備(管理I/F/TLS/レガシー/EOL)。vpn_priority で優先度。

### 4.5 アセスメント（v0.4）
テストケース目録: 認証レジリエンス/セッション/トランスポート/既知脆弱性の限定確認/情報開示。
**MFA判定**: 外部シグナル(SAML/OIDCリダイレクト=likely-idp) + テストIDで実フロー確証(enforced/conditional/absent)。
**ポータルUX**: PC/モバイル/ネイティブの制御一貫性 → **マルチサーフェス相関で不一致=最弱点**を抽出。

### 4.6 補完・タイムリーさ（v0.5）
BitSightを1アダプタとして取り込み、**自前との差分を信号化**（被覆ギャップ/帰属誤り訂正/鮮度差）。
**イベント駆動**: CT/KEV/EPSS/漏洩/BitSight で影響資産のみ即時再評価、MTTD計測。
被覆拡張: メール認証(SPF/DKIM/DMARC/DNSSEC/MTA-STS)・タイポスクワット・露出データサービス・PKI衛生・侵害テレメトリ・集中リスク・アタックパス。

### 4.7 TI統合・評価（v0.6）
データ種別ごとに主ソース＋相互確認(consensus)＋コスト階層。**脅威駆動**（TV/CYFIRMA/GTIでアクター/TTP→ATT&CK初期侵入→露出突合、SOC Prime検知被覆ギャップ）。
NIST CSF等フレームワークにマッピング→機能別スコア。ベクターA–Fグレード→crown-jewel加重→総合レーティング(0–1000)。
**ダブルLLM**: 数値は決定論ルール、Claude/OpenAIは独立評価文＋グレード所見を生成→reconcile→confidence。

### 4.8 Active Rating・魅せる（v0.7）
証跡バンドル必須／反証モード（証跡提示 or 期限切れ自動撤回）／FP率KPI公開。
3D地球儀(攻撃面＋脅威アーク＋組織ツリー)／世界地図(コロプレス/ヒートマップ)。**確定帰属とGeo推測を色分けし誇張しない**。

---

## 5. 統合データモデル（全DDL）

```sql
-- ===== 組織・資産・差分（基盤 / v0.1-0.2,0.5）=====
CREATE TABLE organizations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  parent_id TEXT REFERENCES organizations(id),
  relation_type TEXT NOT NULL CHECK (relation_type IN ('self','subsidiary','supplier','partner','watch')),
  active_confirmed INTEGER NOT NULL DEFAULT 0,
  slack_channel TEXT, notes TEXT, created_at TEXT NOT NULL
);

CREATE TABLE domains (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  fqdn TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
  UNIQUE(org_id, fqdn)
);

CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL REFERENCES domains(id),
  source TEXT NOT NULL, profile TEXT NOT NULL, run_at TEXT NOT NULL,
  asset_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,                        -- hash(domain_id||entity_type||identity)
  domain_id TEXT NOT NULL REFERENCES domains(id),
  org_id TEXT NOT NULL REFERENCES organizations(id),
  entity_type TEXT NOT NULL,                  -- subdomain/dns/service/cert/web/exposure/asn/vpn
  identity TEXT NOT NULL,
  attrs_json TEXT NOT NULL,
  -- 確信度・帰属 (v0.2)
  confidence INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'candidate',    -- candidate/confirmed
  attribution_org_id TEXT REFERENCES organizations(id),
  attribution_conf TEXT NOT NULL DEFAULT 'low',
  source_count INTEGER NOT NULL DEFAULT 1,
  stable_runs INTEGER NOT NULL DEFAULT 0,     -- debounce
  -- 文脈 (v0.5)
  criticality TEXT DEFAULT 'unknown',         -- crown/high/med/low
  data_sensitivity TEXT DEFAULT 'unknown',
  first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'        -- active/gone
);
CREATE INDEX idx_assets_domain ON assets(domain_id);
CREATE INDEX idx_assets_type ON assets(entity_type);

CREATE TABLE changes (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL REFERENCES domains(id),
  org_id TEXT NOT NULL REFERENCES organizations(id),
  asset_id TEXT, entity_type TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('ADDED','REMOVED','CHANGED')),
  severity TEXT NOT NULL DEFAULT 'info',
  before_json TEXT, after_json TEXT,
  detected_at TEXT NOT NULL, notified INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_changes_org ON changes(org_id, detected_at);

-- ===== 評価・リスク（v0.2）=====
CREATE TABLE findings (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  org_id TEXT NOT NULL REFERENCES organizations(id),
  finding_type TEXT NOT NULL,                 -- §6参照
  severity TEXT NOT NULL,                      -- info/low/med/high/critical
  score REAL, evidence_json TEXT,
  status TEXT NOT NULL DEFAULT 'new',          -- new/triaged/accepted/in_progress/resolved
  sla_due TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, resolved_at TEXT
);
CREATE INDEX idx_findings_org ON findings(org_id, severity, status);

CREATE TABLE baselines (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL,    -- asset:<id> | domain:<id>
  expected_json TEXT NOT NULL, approved_by TEXT, approved_at TEXT
);

CREATE TABLE risk_scores (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL,    -- asset:<id> | org:<id>
  score REAL NOT NULL, computed_at TEXT NOT NULL
);
CREATE INDEX idx_risk_scope ON risk_scores(scope, computed_at);

-- ===== VPN（v0.3-0.4）=====
CREATE TABLE vpn_assets (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id),
  product TEXT, version TEXT, cpe TEXT,
  mfa_state TEXT DEFAULT 'unknown',            -- enforced/conditional/likely-idp/absent/unknown
  eol INTEGER DEFAULT 0, jarm TEXT,
  assess_tier_allowed TEXT DEFAULT 'T1',       -- T0..T3
  last_eval_at TEXT
);
CREATE TABLE vpn_cve_refs (
  id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id),
  cve TEXT NOT NULL, kev INTEGER NOT NULL DEFAULT 0, epss REAL, cvss REAL,
  verified_by TEXT, detected_at TEXT NOT NULL
);
CREATE INDEX idx_vpncve_asset ON vpn_cve_refs(asset_id, kev);
CREATE TABLE vpn_cred_exposure (
  id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id),
  source TEXT NOT NULL, identifier TEXT,       -- 生PWは保存しない
  stealer_url_hit INTEGER DEFAULT 0, first_seen TEXT NOT NULL
);

-- ===== アセスメント（v0.4）=====
CREATE TABLE assessments (
  id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id),
  tier TEXT NOT NULL, roe_ref TEXT, change_ticket TEXT,
  window_start TEXT, window_end TEXT, operator TEXT,
  started_at TEXT NOT NULL, ended_at TEXT
);
CREATE TABLE assess_results (
  id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL REFERENCES assessments(id),
  category TEXT NOT NULL,                       -- auth/session/transport/vuln/disclosure/mfa/ux
  test_case TEXT NOT NULL, surface TEXT,        -- pc/mobile/native/-
  result TEXT NOT NULL,                         -- pass/fail/na/needs-review
  severity TEXT, evidence_json TEXT, created_at TEXT NOT NULL
);
CREATE INDEX idx_assessres_cat ON assess_results(category, result);
CREATE TABLE surface_controls (
  asset_id TEXT NOT NULL REFERENCES assets(id),
  surface TEXT NOT NULL,                        -- pc/mobile/native
  controls_json TEXT NOT NULL, observed_at TEXT NOT NULL,
  PRIMARY KEY (asset_id, surface)
);

-- ===== BitSight・タイムリーさ（v0.5）=====
CREATE TABLE bitsight_findings (
  id TEXT PRIMARY KEY, org_id TEXT REFERENCES organizations(id),
  asset_ref TEXT, vector TEXT, grade TEXT, detail_json TEXT,
  observed_at TEXT NOT NULL, reconciled TEXT DEFAULT 'pending'  -- matched/gap/attribution_error/stale
);
CREATE TABLE detection_latency (
  id TEXT PRIMARY KEY, finding_id TEXT REFERENCES findings(id),
  trigger TEXT,                                 -- ct/kev/leak/bitsight/scheduled
  event_at TEXT, detected_at TEXT, mttd_sec INTEGER, bitsight_seen_at TEXT
);

-- ===== TI統合・評価（v0.6）=====
CREATE TABLE ti_enrichment (
  id TEXT PRIMARY KEY, indicator TEXT NOT NULL, itype TEXT NOT NULL,
  source TEXT NOT NULL, verdict TEXT, score REAL, actor_json TEXT,
  fetched_at TEXT NOT NULL, ttl_sec INTEGER
);
CREATE INDEX idx_ti_ind ON ti_enrichment(indicator, itype);
CREATE TABLE ti_consensus (
  indicator TEXT PRIMARY KEY,
  malicious_sources INTEGER DEFAULT 0, total_sources INTEGER DEFAULT 0,
  confidence TEXT, updated_at TEXT             -- confirmed/suspect/clean
);
CREATE TABLE framework_scores (
  id TEXT PRIMARY KEY, org_id TEXT REFERENCES organizations(id),
  framework TEXT NOT NULL,                      -- nist_csf/cis/iso27001/meti
  function_or_control TEXT NOT NULL, score REAL NOT NULL,
  evidence_json TEXT, period TEXT NOT NULL
);
CREATE TABLE attack_vectors (
  id TEXT PRIMARY KEY, org_id TEXT REFERENCES organizations(id),
  vector TEXT NOT NULL, grade TEXT NOT NULL, score REAL NOT NULL,
  threat_weight REAL, detection_gap INTEGER, trend TEXT, period TEXT NOT NULL
);
CREATE TABLE overall_ratings (
  id TEXT PRIMARY KEY, org_id TEXT REFERENCES organizations(id),
  score REAL NOT NULL, grade TEXT NOT NULL, confidence REAL,
  bitsight_ref REAL, computed_at TEXT NOT NULL
);
CREATE TABLE dual_eval (
  id TEXT PRIMARY KEY, subject TEXT NOT NULL,   -- vector:vpn / framework:DE / overall
  claude_json TEXT, openai_json TEXT, deterministic_grade TEXT,
  agreement TEXT,                               -- agree/llm_divergence/rule_divergence
  needs_review INTEGER DEFAULT 0, created_at TEXT NOT NULL
);

-- ===== Active Rating 証跡・可視化（v0.7）=====
CREATE TABLE evidence_bundles (
  id TEXT PRIMARY KEY, finding_id TEXT REFERENCES findings(id),
  method TEXT NOT NULL, proof_json TEXT NOT NULL, snapshot_ref TEXT,
  sources_json TEXT, confidence INTEGER, observed_at TEXT NOT NULL, ttl_sec INTEGER
);
CREATE TABLE disputes (
  id TEXT PRIMARY KEY, finding_id TEXT REFERENCES findings(id),
  claim TEXT, outcome TEXT,                     -- upheld/retracted
  revalidated_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE geo_points (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id),
  lat REAL, lon REAL, geo_source TEXT,
  attribution TEXT, grade TEXT, criticality TEXT  -- confirmed/estimated ← 色分け根拠
);
CREATE TABLE threat_arcs (
  id TEXT PRIMARY KEY, src_lat REAL, src_lon REAL,
  dst_asset_id TEXT REFERENCES assets(id),
  ti_source TEXT, severity TEXT, observed_at TEXT NOT NULL
);
```

---

## 6. 列挙・辞書

**entity_type**: subdomain / dns / service / cert / web / exposure / asn / vpn

**finding_type**:
`takeover` `cve` `tls` `port_drift` `secret` `dangling_dns`（v0.2）/
`vpn_cve` `vpn_cred_exposure` `vpn_misconfig` `vpn_ux`（v0.3-0.4）/
`email_auth` `typosquat` `exposed_service` `pki` `concentration` `attack_path`（v0.5）

**attack vector**: vpn / webapp / email / dns / credential / cloud / pki / netsvc / compromise

**framework**: nist_csf(GV/ID/PR/DE/RS/RC) / cis(IG1-3) / iso27001 / meti

**TIソース**: vt, gti, recorded_future, intel471, cyfirma, threatvision, socprime, domaintools, dnslytics, shodan, urlscan, abuseipdb, maxmind, bitsight

**severity**: info / low / med / high / critical

---

## 7. APIコスト階層

```
Tier1(無料/安価・広く): AbuseIPDB, MaxMind, DNSLytics, Shodan照会, urlscan, crt.sh, Chaos, HIBP
Tier2(中):              VT/GTI, DomainTools
Tier3(高・重大時のみ):  Recorded Future, Intel 471, CYFIRMA, ThreatVision, SOC Prime, BitSight
エスカレーション条件: severity>=med もしくは crown-jewel隣接 の資産のみ Tier3 へ
キャッシュ: ti_enrichment に TTL 付で保存し再叩き抑制
```

---

## 8. ディレクトリ構成

```
active-rating/
├─ scanner/                    # GitHub Actions (TS/Node)
│  ├─ src/
│  │  ├─ adapters/             # crtsh, chaos, subfinder, dnsx, httpx, intelx, hibp,
│  │  │                        # censys, shodan, netlas, greynoise, ipinfo, securitytrails,
│  │  │                        # vt, gti, recorded_future, intel471, cyfirma, threatvision,
│  │  │                        # socprime, domaintools, dnslytics, abuseipdb, urlscan, bitsight
│  │  ├─ discovery/            # 発見(seed pivot, permutation, wildcard, netblock, deepweb)
│  │  ├─ vpn/                  # 指紋, cve照合, cred相関, misconfig
│  │  ├─ assess/               # T1-T3, mfa, surface(pc/mobile/native)
│  │  ├─ normalize/            # エンティティ別正規化
│  │  ├─ profile.ts            # relation_type→active/passive
│  │  ├─ orchestrator.ts       # 組織ツリー→ドメイン→アダプタ
│  │  └─ ingest-client.ts      # POST /ingest (HMAC)
│  └─ package.json
├─ worker/                     # Cloudflare Workers
│  ├─ src/
│  │  ├─ index.ts  ingest.ts  diff.ts
│  │  ├─ confidence.ts attribution.ts        # 正確さ
│  │  ├─ enrich.ts consensus.ts              # TI相互確認
│  │  ├─ score/  framework.ts vector.ts overall.ts
│  │  ├─ dual-eval.ts                         # Claude+OpenAI reconcile
│  │  ├─ events/  ct.ts kev.ts leak.ts bitsight.ts  # イベント駆動
│  │  ├─ dispute.ts                           # 反証モード
│  │  ├─ notify-slack.ts  api.ts
│  ├─ schema.sql               # §5
│  └─ wrangler.toml
├─ pages/                      # 可視化 (React)
│  ├─ globe/  map/  gauge/  radar/  attackpath/  mttd/  dispute/
│  └─ ...
└─ .github/workflows/
   ├─ scan-active.yml   scan-passive.yml   deep-weekly.yml   seed-monthly.yml
```

---

## 9. 主要スケルトン

### `worker/src/index.ts`
```typescript
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/ingest' && req.method === 'POST') {
      if (!(await verifyHmac(req, env.INGEST_HMAC))) return new Response('bad sig', { status: 401 });
      return ingest(req, env);
    }
    if (url.pathname === '/dispute' && req.method === 'POST') return handleDispute(req, env);
    if (url.pathname.startsWith('/api/')) return api(req, env);
    return new Response('ok');
  },
  async scheduled(_e, env: Env) {
    await pollCT(env); await pollKEV(env); await pollLeak(env); await pollBitsight(env);
    await resendUnnotified(env);
  },
  async queue(batch, env: Env) {           // イベント駆動: 影響資産のみ再評価
    for (const m of batch.messages) await reevaluateAsset(m.body.asset_id, env);
  }
};
```

### 差分＋証跡（`ingest.ts` 抜粋）
```
for e in normalized_entities:
  if new:      upsert; emit ADDED; build_evidence_bundle(e)
  elif changed:update; emit CHANGED; refresh_evidence_bundle(e)
  else:        touch last_seen; stable_runs++      # debounce
if source.is_authoritative: mark_gone(unseen) → emit REMOVED
record_snapshot; flush_notifications()
```

### ダブルLLM（`dual-eval.ts` 抜粋）
```
det = deterministic_scores(subject)                 # 真値
[c, o] = await Promise.all([claude(subject, det), openai(subject, det)])
if agree(c, o, det):        confidence=high; publish(narrative=c)
elif llm_vs_rule_diverge:   flag needs_review('rule_divergence')
else:                       flag needs_review('llm_divergence'); publish(both)
```

（各アダプタ・発見・VPN・アセスメントの詳細は v0.2〜v0.6 分冊参照）

---

## 10. ロードマップ（フェーズ）

| Phase | 目標 | 主な成果物 |
|---|---|---|
| **P1 基盤** | マルチテナント＋差分＋Slack | organizations/domains/assets/changes, /ingest, 日次Actions |
| **P2 深さ・正確さ** | 発見拡張＋確信度/帰属 | discovery/, confidence/attribution, evidence_bundle |
| **P3 VPN＋アセスメント** | VPN深掘り＋MFA/UX | vpn/, assess/, surface相関 |
| **P4 TI＋タイムリーさ** | TI統合＋イベント駆動 | adapters拡充, events/, consensus, MTTD |
| **P5 評価・レーティング** | framework/vector/overall＋ダブルLLM | score/, dual-eval |
| **P6 Active Rating・魅せる** | 証跡/反証＋可視化 | dispute, globe/map/gauge, FP率KPI |

---

## 11. 用語集
- **Active Rating**: 本製品。能動検証・証跡主義の攻撃面評価。
- **evidence bundle**: 各評価に紐づく証跡（手法・証明・ソース・confidence・鮮度）。
- **confidence / candidate / confirmed**: 資産の確からしさ段階。
- **attribution**: 資産がどの組織のものかの帰属（ASN/cert/whoisで検証）。
- **debounce**: N回連続観測でseverity確定する過渡誤報抑制。
- **profile (active/passive)**: 所有関係で決まるスキャン強度。
- **assessment tier (T0-T3)**: 受動〜侵襲的実証の段階。
- **MTTD**: 検知までの時間。BitSight比較で優位を定量化。
- **crown-jewel**: 事業重要度の高い資産。優先度加重の基準。
- **dispute / 反証モード**: 誤り主張への証跡提示・自動撤回。
- **FP rate**: 誤検知率。正確さのKPI。

---

## 12. 全体の未決事項（分冊から集約）
- [ ] ULID採番位置 / is_authoritativeなソースの確定
- [ ] confidence重み・確信閾値、consensus判定ソース数
- [ ] active_confirmed / crown-jewel 付与の承認フロー（誰が）
- [ ] KEV/EPSS/NVDフィード取り込み、イベントキュー基盤(Workers Queues無料枠)
- [ ] framework採点係数、vectorグレード算式、overall合成式、assessment_confidence式
- [ ] ダブルLLM必須subjectの閾値（コスト対効果）
- [ ] MFA判定シグナル辞書、テストID発行/失効、RoE承認ワークフロー
- [ ] タイポスクワット判定、メール認証のサブドメイン網羅
- [ ] 各TI APIのquota確認とTier閾値
- [ ] 地図タイル供給、地球儀のLOD/クラスタリング
- [ ] クレデンシャル暗号化(SQLCipher/フィールド暗号)、証跡R2保存期間
- [ ] Cloudflare Accessロール設計、Active Ratingスコア対外開示ポリシー

---

*Active Rating 統合設計書 v1.0 — v0.1〜v0.7 を統合。実装は本書＋各分冊を参照。*
