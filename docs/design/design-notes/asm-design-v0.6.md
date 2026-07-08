# ASM 設計ドキュメント v0.6 — TIスタック統合・フレームワーク評価・総合レーティング・ダブルLLM

v0.1〜v0.5 の続き。多数の脅威インテリジェンス(TI)APIを統合し、
**フレームワーク観点（NIST CSF等）の評価・総合レーティング・アタックベクター別ランク**を付けて
**経営層にも分かる**アセスメント深度を持たせる。仕上げに **Claude + OpenAI のダブル統合評価**。

---

## A. TIスタック統合 — 「全部叩く」ではなく主ソース＋相互確認＋コスト階層

### A-1. 各APIの役割マップ
| API | 主用途 | 層 |
|---|---|---|
| **VirusTotal / GTI** | file/URL/domain/IP評判・passive DNS・関連性、**GTIはMandiantのアクター/キャンペーン文脈** | 評判+アクター |
| **Recorded Future** | リスクスコア(IP/dom/hash)・**脆弱性インテリ(実悪用の即時性)**・アクター・漏洩 | 脆弱性即時+評判 |
| **Intel 471** | 地下/サイバー犯罪・**クレデンシャル/マーケット/フォーラム** | クレデンシャル/地下 |
| **CYFIRMA (DeCYFIR)** | 外部脅威景観・デジタルリスク・**アジア標的のアクター追跡**・IoC | アクター(地域) |
| **ThreatVision (TeamT5)** | **China-nexus/東アジアAPT**・IoC・アドバーサリレポート | アクター(APT) |
| **SOC Prime** | **Sigma検知コンテンツ・ATT&CKマップ検知** | 検知被覆 |
| **DomainTools** | whois/passive DNS/reverse whois/ドメインリスク | ドメイン |
| **DNSLytics** | passive DNS/reverse IP/解析タグpivot | ドメイン |
| **Shodan** | 露出サービス/banner/port(照会) | 露出 |
| **urlscan** | URLスキャン/スクショ/DOM・**魚拓(証跡保全)** | Web証跡 |
| **AbuseIPDB** | IP不正評判(通報ベース) | IP評判 |
| **MaxMind** | GeoIP/ASN | エンリッチ |

> ※各APIの利用可能エンドポイント/quotaは契約依存。実装前に確認。

### A-2. データ種別ごとの主ソース＋相互確認（重複の捌き方）
| データ種別 | 主(primary) | 相互確認(corroborate) | 確信度ルール |
|---|---|---|---|
| IP評判 | AbuseIPDB | VT/GTI, RF | **2ソース以上一致で"confirmed malicious"** |
| ドメイン評判/年齢 | DomainTools | VT, DNSLytics | 単一は"suspect"止まり |
| passive DNS | DomainTools | VT, DNSLytics | 和集合を取り重複排除 |
| 脆弱性の実悪用 | **Recorded Future** | GTI, CYFIRMA, CISA KEV | RF+KEVで最優先(v0.3/0.5と接続) |
| アクター/キャンペーン | GTI(Mandiant) | ThreatVision, CYFIRMA, RF | **地域重み**: 東アジア標的はTV/CYFIRMA優先 |
| クレデンシャル/地下 | Intel 471 | RF, IntelX(v0.3) | 相関でcritical昇格 |
| 検知被覆 | SOC Prime | — | ATT&CK技法単位で被覆有無 |
| Web証跡/フィッシング | urlscan(魚拓) | VT | タイポスクワット即時保全(v0.5 E-2) |

### A-3. コスト/レート階層（賢く使う）
```
Tier1(無料/安価・広く): AbuseIPDB, MaxMind, DNSLytics, Shodan照会, urlscan
Tier2(中): VT/GTI, DomainTools
Tier3(高・重大時のみ): Recorded Future, Intel 471, CYFIRMA, ThreatVision
→ severity>=med or crown-jewel隣接 の資産に限りTier3へエスカレーション
```
- ノイズと課金を抑えつつ、効く所だけ深掘り。エンリッチ結果は `ti_enrichment` にキャッシュ(TTL付)。

---

## B. 脅威駆動の文脈化（BitSight/汎用スコアとの決定的差）

### B-1. 「うちを狙うアクター」起点
- ThreatVision/CYFIRMA/GTI から **自組織・自業種・日本標的のアクターとTTP**を抽出
- そのTTPの **初期侵入技法(ATT&CK Initial Access)** を列挙 → 自前の露出資産に突合
- 例: 「T1190(公開アプリ悪用)を使うアクターが活動中 × うちの脆弱VPN露出」→ ベクター重みを引き上げ

### B-2. 検知被覆ギャップ（SOC Prime × ATT&CK）
- 抽出したTTPに対し **SOC PrimeのSigma検知が自環境にあるか**を照合
- 「露出あり × 悪用中TTP × 検知なし」= **最悪の三重苦**として最優先（NIST CSF DEの穴として可視化, §C）

---

## C. フレームワーク評価レイヤ（経営層の共通言語）

ASM所見を主要フレームワークにマッピングし、機能別スコアを出す。

### C-1. NIST CSF 2.0 マッピング（主軸）
| Function | ASMが与える所見 | 評価対象 |
|---|---|---|
| **GV** Govern | 総合姿勢・第三者/集中リスク(v0.5) | ガバナンス指標(参考) |
| **ID** Identify | 資産発見/帰属(v0.2)・リスク評価 | ID.AM 資産管理 / ID.RA リスク |
| **PR** Protect | MFA(v0.4)・設定/TLS・メール認証(v0.5) | PR.AA 認証 / PR.PS 構成堅牢化 |
| **DE** Detect | **検知被覆(SOC Prime §B-2)**・継続監視 | DE.CM 継続監視 / DE.AE 分析 |
| **RS** Respond | 露出×未対応SLA・テイクダウン起票 | 対応準備の間接指標 |
| **RC** Recover | (ASM寄与は限定・正直に注記) | — |

- 各Functionを **0–100 + 成熟度段階** で採点。ASMは特に **ID/PR/DE** に強く寄与、RS/RCは間接。
- 補助マッピング: **CIS Controls v8**(IG1-3), **ISO 27001 Annex A**, 経産省サイバーセキュリティ経営ガイドライン(和文報告用)を拡張可能に。

### C-2. 採点の接地
- スコアは**決定論ルール**で算出（finding種別×重大度×被覆率）。LLMは説明生成のみ(§F)。
- 証跡リンク付き（どのfindingがどのカテゴリを下げたか追跡可能）。

---

## D. アタックベクター・ランキング（BitSight風だが脅威駆動で深い）

外部攻撃面をベクターに分解し、各に **グレード(A–F)＋スコア＋根拠＋トレンド＋脅威重み**を付与。

| # | アタックベクター | 主な入力 | 脅威重み例 |
|---|---|---|---|
| 1 | **リモートアクセス/VPN** | v0.3/0.4 全部 | T1133/T1190悪用アクター活動時↑ |
| 2 | Webアプリ | httpx/nuclei/urlscan | T1190 |
| 3 | メール/フィッシング面 | SPF/DKIM/DMARC(v0.5) | T1566 |
| 4 | DNS/ドメイン/ブランド | タイポスクワット(v0.5) | T1583 |
| 5 | クレデンシャル/地下露出 | Intel471/IntelX/RF | T1078/T1110 |
| 6 | クラウド/データ露出 | 露出サービス(v0.5) | T1530 |
| 7 | 証明書/PKI | 影の証明書(v0.5) | — |
| 8 | ネットワークサービス/ポート | Shodan/naabu | T1190 |
| 9 | 侵害兆候 | BitSight/GTI/AbuseIPDB | 既侵害 |

**グレード算式（例）**
```
vector_score = 100
  - Σ(finding_severity_weight)
  - Σ(threat_weighted_boost)          # 悪用中TTP×該当露出で減点強化
  - detection_gap_penalty(SOC Prime)  # 検知なしでさらに減点
  → A(90+)/B/C/D/F(<50)
trend = 前期比(risk_scores時系列, v0.2)
```

---

## E. 総合レーティング（経営ボード向け）

- **合成**: 各ベクターグレードを **crown-jewel重み(v0.5 D-1)** で加重平均 → 総合スコア(0–1000)＋レター(A–F)
- **トレンド矢印**＋**BitSightスコア並置**（乖離＝自前が先に検知した優位の証跡, v0.5 F）
- **信頼度(assessment confidence)**: データ網羅性×ソース相互確認×ダブルLLM一致度(§F)
- 監査可能: 総合 → ベクター → finding → 生エンリッチ、までドリルダウン。

---

## F. Claude + OpenAI ダブル統合評価

数値は決定論エンジンが出す。**LLMは独立に評価文＋グレード所見を生成し、突き合わせて整合を担保**する。

### F-1. 役割と流れ
```
[決定論エンジン] framework_scores / vector grades / total rating を算出(証跡付)
        │
        ├─ Claude   : 独立に (a)finding→framework妥当性検証 (b)ベクターグレード所見 (c)経営向け説明
        ├─ OpenAI   : 同じ入力で独立に同項目を生成
        │
   [reconcile]
     - 数値/グレードが両LLM & 決定論で一致 → high confidence、経営サマリ確定
     - LLM所見が決定論グレードと乖離 → "ルールの穴 or データ異常" として human-review起票
     - 両LLM間で不一致 → needs_review、両論併記で提示
```

### F-2. 精度ガードレール
- **スコアの真値はルール**。LLMに数値を上書きさせない（ドリフト防止）。LLMは「その数値は妥当か」を批評する検証者。
- CVE/アクター/TTPの固有名は **TI/NVD/ATT&CKで裏取り**してから採用（幻覚排除, v0.3 §E継承）。
- `assessment_confidence = f(model_agreement, source_corroboration, data_completeness)` を明示提示。
- 高格差（総合レーティングを動かす）判断のみダブルLLM必須、日常はTier1で足切り後に投入（コスト管理）。

### F-3. 出力
- **経営層**: 1ページ（総合レーティング＋トレンド、上位ベクターのグレード、CSFレーダー、"今四半期の要対応Top N"、BitSight比較、confidence）
- **技術層**: ドリルダウン（ベクター→finding→エンリッチ証跡→推奨アクション/SLA）
- 和文/英文両対応（i18n）。

---

## G. データモデル追加（v0.5 §G への差分）

```sql
-- TIエンリッチ(キャッシュ＋相互確認)
CREATE TABLE ti_enrichment (
  id          TEXT PRIMARY KEY,
  indicator   TEXT NOT NULL,        -- ip/domain/hash/url
  itype       TEXT NOT NULL,
  source      TEXT NOT NULL,        -- vt/gti/rf/intel471/cyfirma/threatvision/abuseipdb/...
  verdict     TEXT,                 -- malicious/suspicious/clean/unknown
  score       REAL,
  actor_json  TEXT,                 -- 関連アクター/TTP
  fetched_at  TEXT NOT NULL,
  ttl_sec     INTEGER
);
CREATE INDEX idx_ti_ind ON ti_enrichment(indicator, itype);

-- 相互確認の集約(確信度)
CREATE TABLE ti_consensus (
  indicator   TEXT PRIMARY KEY,
  malicious_sources INTEGER DEFAULT 0,
  total_sources     INTEGER DEFAULT 0,
  confidence  TEXT,                 -- confirmed/suspect/clean
  updated_at  TEXT
);

-- フレームワークスコア
CREATE TABLE framework_scores (
  id          TEXT PRIMARY KEY,
  org_id      TEXT REFERENCES organizations(id),
  framework   TEXT NOT NULL,        -- nist_csf/cis/iso27001/meti
  function_or_control TEXT NOT NULL,-- GV/ID/PR/DE/RS/RC or ID.AM ...
  score       REAL NOT NULL,
  evidence_json TEXT,
  period      TEXT NOT NULL
);

-- アタックベクターのランク
CREATE TABLE attack_vectors (
  id          TEXT PRIMARY KEY,
  org_id      TEXT REFERENCES organizations(id),
  vector      TEXT NOT NULL,        -- vpn/webapp/email/dns/credential/cloud/pki/netsvc/compromise
  grade       TEXT NOT NULL,        -- A..F
  score       REAL NOT NULL,
  threat_weight REAL,               -- 悪用中TTP由来の重み
  detection_gap INTEGER,            -- SOC Prime被覆なし数
  trend       TEXT,
  period      TEXT NOT NULL
);

-- 総合レーティング
CREATE TABLE overall_ratings (
  id          TEXT PRIMARY KEY,
  org_id      TEXT REFERENCES organizations(id),
  score       REAL NOT NULL,        -- 0-1000
  grade       TEXT NOT NULL,
  confidence  REAL,
  bitsight_ref REAL,
  computed_at TEXT NOT NULL
);

-- ダブルLLM評価
CREATE TABLE dual_eval (
  id          TEXT PRIMARY KEY,
  subject     TEXT NOT NULL,        -- vector:vpn / framework:DE / overall
  claude_json TEXT,
  openai_json TEXT,
  deterministic_grade TEXT,
  agreement   TEXT,                 -- agree/llm_divergence/rule_divergence
  needs_review INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL
);
```

---

## H. 評価パイプライン統合像

```
資産/所見(v0.1-0.5)
  → TIエンリッチ(A: 主ソース→相互確認→consensus, コスト階層)
  → 脅威駆動文脈(B: アクター/TTP × 露出 × SOC Prime検知被覆)
  → 決定論スコアリング(C framework / D vector / E overall)
  → ダブルLLM統合評価(F: Claude+OpenAI 独立→reconcile→confidence)
  → 経営1ページ + 技術ドリルダウン(和/英)
  → Slack(critical即時) / 週次経営ダイジェスト
```

---

## I. 未決事項 / 次アクション

- [ ] 各TI APIのquota/エンドポイント確認とコスト階層の閾値確定
- [ ] IP/ドメイン評判の"confirmed"判定ソース数しきい値
- [ ] アクター→TTP→ATT&CK技法の正規化辞書（TV/CYFIRMA/GTIの表記統一）
- [ ] framework採点ルール（finding種別×重大度→CSFカテゴリの係数表）
- [ ] vectorグレード算式の重み・脅威重みの反映度
- [ ] ダブルLLMをどのsubjectで必須にするか（コスト対効果）
- [ ] assessment_confidence の合成式
- [ ] 経営1ページのレイアウト（CSFレーダー/ベクター表/Top N/BitSight比較）

---

*v0.6 — TIスタック統合＋NIST CSF等フレームワーク評価＋総合レーティング/ベクターランク＋Claude/OpenAIダブル統合評価。v0.1〜v0.5と併用。*
