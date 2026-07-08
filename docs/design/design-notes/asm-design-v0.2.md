# ASM 設計ドキュメント v0.2 — 深さ・正確さ・継続評価レイヤ（自社所有スコープ）

v0.1 の続き。前提: 自社＋子会社は **100%保有 → 全 active 許可**。
このスコープでは差分検知だけでなく、**発見の網羅性（深さ）／帰属の正確さ（確信度）／リスクの継続評価（推移）** を追加する。

> v0.1 の §3(プロファイル)・§4(データモデル)・§7(差分) を土台に、以下を上乗せする。
> passive スコープ（サプライチェーン等）は v0.1 のまま。本書は active スコープ限定。

---

## A. 3つの追加目標

| 軸 | 目的 | 中核機能 |
|---|---|---|
| **深さ (Depth)** | 未知資産をこぼさない | 関連ドメインpivot・permutation列挙・netblock掃引・deep web層 |
| **正確さ (Accuracy)** | 誤検知/誤帰属を潰す | 確信度スコア・帰属モデル・wildcard処理・debounce |
| **継続評価 (Continuous)** | 状態でなくリスク推移を追う | takeover/nuclei/TLS/baseline drift・スコアの時系列 |

---

## B. 深さ — 発見パイプライン（active/owned）

段階を分け、各段の出力が次段の入力になる再帰構造にする。

### B-1. シード拡張（自社が持つ“未把握ドメイン”の発掘）
apexドメインの取りこぼしがそのまま盲点になるので最初にやる。

- **whois/登録者 pivot**: DNSlytics / DomainTools reverse-whois / WhoisXML で登録者・組織名から逆引き
- **証明書 Org pivot**: crt.sh を Organization 名で検索、Censys の `parsed.subject.organization`
- **favicon hash pivot**: Shodan `http.favicon.hash:<mmh3>` で同一faviconの資産
- **解析タグ pivot**: GA/GTM/AdSense ID を DNSlytics / publicwww / SpyOnWeb で相互参照
- **ASN → netblock**: 自社ASNから全CIDRを展開（bgp.he.net / IPinfo / RIR whois）

→ 発見した apex は `domains` に candidate として登録し、**人手承認後に enabled**（誤って他社を巻き込まない安全弁）。

### B-2. サブドメイン列挙（多技法・多段）
```
passive : crt.sh, Chaos, subfinder(全ソース), IntelX, SecurityTrails, DNSlytics
   ↓ 統合
active brute : puredns/dnsx + wordlist(assetnote best-dns, jhaddix all.txt)
   ↓ 発見名を種に
permutation : alterx / gotator / dnsgen → 再解決
   ↓ 新apex/新パターン発見時
recursive : 上記を再投入（深さ上限 N で停止）
```

### B-3. Wildcard DNS 処理（正確さの生命線）
brute の最大の誤検知源。列挙前に必ず。
- ランダムFQDNを複数投げて wildcard 応答有無を検出、**wildcard IP集合**を算出
- brute結果のうち wildcard IP にしか一致しないものは**除外**（または confidence を大幅減点）
- 別解決（別レコード/別ポート応答）があるものだけ実体として残す

### B-4. 解決・生存確認
- **信頼できるリゾルバ**限定リストで mass resolve（公開リゾルバのポイズニング回避）
- レート制御（ブロック/スロットル回避 = 継続運用の前提）
- httpx で生存・リダイレクト・技術判定（**owned限定**）

### B-5. Netblock 掃引（自社IP空間を持つ強み）
- 自社CIDRに対し **PTR逆引き掃引** → 名前のない資産も捕捉
- naabu/masscan でポート発見（**自社IP空間のみ**、レート厳守）→ service ID

### B-6. Deep Web 層（生存ホスト上）
- 技術指紋（wappalyzer相当）、gowitness でスクショ
- katana でクロール → subjs/linkfinder で **JSからエンドポイント/隠しAPI抽出**
- 露出した `.git` / `.env` / バックアップ / ディレクトリリスティング検出

### B-7. クラウド・コード露出
- 自社Org名でバケット列挙（S3/GCS/Azure Blob）
- GitHub org/公開リポの dork（鍵・内部ホスト名の漏洩）

---

## C. 正確さ — 確信度・帰属モデル

「深く広く拾う」ほど FP と誤帰属が増える。スコアで一次情報の質を担保する。

### C-1. 資産確信度（asset confidence 0–100）
```
confidence =
    w1 * source_count_norm        # 独立ソース数（多いほど確か）
  + w2 * active_resolved          # 能動解決で生存確認できたか
  + w3 * in_owned_asn             # 自社ASN/CIDR内か
  + w4 * cert_org_match           # 証明書Orgが自社と一致
  + w5 * not_wildcard_only        # wildcard由来でない
  - p1 * parked_or_sinkhole       # パーキング/シンクホール減点
  - p2 * shared_cdn_ip            # 共有CDN IP（帰属不能）減点
```
- `confidence >= 確信閾値` → **confirmed**（通知・評価対象）
- それ未満 → **candidate**（追跡はするが低severity、誤報を出さない）
- **相互確認ルール**: 独立2ソース以上 or 能動解決成功 → confirmed へ昇格

### C-2. 帰属（attribution）
「これは自社ツリーのどの組織の資産か」を明示。
- IPが自社CIDR内 / 証明書Orgが自社 / whois登録者が自社 → `attribution_org_id` を確定
- **共有CDN・共有ホスティングIP は帰属保留**（CDNのIPを自社と誤認しない）
- 帰属できないものは `attribution_confidence=low` として棚卸しキューへ

### C-3. Debounce（過渡的変化の誤報抑制）
- 高信号（takeover / leak / 失効証明書）は**即時**エスカレーション
- それ以外の変化は **N回連続で観測されて初めて severity 確定**（DNS伝播やABテストの一時応答での誤報を防ぐ）

---

## D. 継続評価 — リスク推移を追う

差分(changes)とは別に、**評価結果(findings)** と **スコア時系列(risk_scores)** を持つ。

### D-1. 評価チェック（各runで実行）
| 評価 | 手法 | severity目安 |
|---|---|---|
| **サブドメインテイクオーバー** | dangling CNAME を未取得サービスへ指す検出（自社の最重要チェック） | high |
| 既知脆弱性/誤設定 | nuclei テンプレート（CVE, 露出パネル, デフォルト認証, takeover） | 内容依存 |
| TLS 健全性 | プロトコル/暗号/有効期限（失効・失効間近） | med〜high |
| ポート露出ドリフト | baseline許可ポートとの差 | med |
| 露出秘密 | IntelX / JS内秘密 / `.env`/`.git` | high |
| dangling DNS | 解決不能CNAME/NS残骸 | med |
| 鮮度/退役 | Nラン未観測 → decommission候補 | low |

### D-2. Baseline & Drift
- 資産（またはドメイン）ごとに**期待状態**を定義: 許可ポート, 期待TLS, 期待tech
- 観測 vs baseline の差を **drift finding** 化
- baseline は初回確定後、承認フローで更新（勝手に追随させない＝ドリフトを見逃さない）

### D-3. リスクスコアと集約
```
asset_risk = f(open_exposure, tls_grade, vuln_findings, secret_hits, takeover_flag, freshness)
org_risk   = Σ weighted(asset_risk over org subtree)   # 組織ツリーで積み上げ
```
- 各runで再計算 → `risk_scores` に時系列で保存
- ダッシュボードで **攻撃面サイズ / findings件数 / MTTD の推移**を可視化（チャート化前提）

### D-4. Finding ライフサイクル（SLA）
```
new → triaged → (accepted | in_progress) → resolved
     └ severity別 SLA 期限(sla_due) を付与、超過で再通知
```

---

## E. データモデル追加（v0.1 §4 への差分）

```sql
-- assets に確信度・帰属を追加
ALTER TABLE assets ADD COLUMN confidence            INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assets ADD COLUMN state                 TEXT NOT NULL DEFAULT 'candidate'; -- candidate/confirmed
ALTER TABLE assets ADD COLUMN attribution_org_id    TEXT REFERENCES organizations(id);
ALTER TABLE assets ADD COLUMN attribution_conf      TEXT NOT NULL DEFAULT 'low';       -- low/med/high
ALTER TABLE assets ADD COLUMN source_count          INTEGER NOT NULL DEFAULT 1;
ALTER TABLE assets ADD COLUMN stable_runs           INTEGER NOT NULL DEFAULT 0;        -- debounce用

-- 評価結果（差分ログとは別のリスク台帳）
CREATE TABLE findings (
  id          TEXT PRIMARY KEY,
  asset_id    TEXT NOT NULL REFERENCES assets(id),
  org_id      TEXT NOT NULL REFERENCES organizations(id),
  finding_type TEXT NOT NULL,   -- takeover/cve/tls/port_drift/secret/dangling_dns/...
  severity    TEXT NOT NULL,    -- info/low/med/high/critical
  score       REAL,             -- CVSS等
  evidence_json TEXT,
  status      TEXT NOT NULL DEFAULT 'new', -- new/triaged/accepted/in_progress/resolved
  sla_due     TEXT,
  first_seen  TEXT NOT NULL,
  last_seen   TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX idx_findings_org ON findings(org_id, severity, status);

-- 期待状態（ドリフト検知の基準）
CREATE TABLE baselines (
  id         TEXT PRIMARY KEY,
  scope      TEXT NOT NULL,     -- asset:<id> | domain:<id>
  expected_json TEXT NOT NULL,  -- {ports:[443], tls_min:'1.2', tech:[...]}
  approved_by TEXT,
  approved_at TEXT
);

-- リスクスコア時系列（asset/orgの両粒度）
CREATE TABLE risk_scores (
  id        TEXT PRIMARY KEY,
  scope     TEXT NOT NULL,      -- asset:<id> | org:<id>
  score     REAL NOT NULL,
  computed_at TEXT NOT NULL
);
CREATE INDEX idx_risk_scope ON risk_scores(scope, computed_at);
```

---

## F. 継続評価ループ（1run）

```
discover(B) → wildcard filter(B-3) → resolve/liveness(B-4)
   → confidence & attribution(C)
   → evaluate: takeover / nuclei / tls / drift / secret(D-1,D-2)
   → debounce(C-3): stable_runs++ / severity確定
   → diff → changes追記(v0.1 §7)
   → findings upsert + SLA付与(D-4)
   → risk_scores 再計算(D-3)
   → Slack通知(v0.1 §9: 高信号即時 / それ以外サマリ)
```

---

## G. ツール追加（scanner、owned限定で実行）

| 用途 | ツール |
|---|---|
| passive列挙 | subfinder, crt.sh, chaos |
| 解決/brute | puredns, massdns, dnsx |
| permutation | alterx, gotator, dnsgen |
| ポート | naabu, masscan（自社IPのみ） |
| web/技術 | httpx, katana, gowitness |
| JS解析 | subjs, linkfinder |
| 脆弱性/takeover | nuclei（takeover/cve/exposureテンプレ） |
| 通知 | notify（Workers経由でSlackに集約） |

> いずれも Actions runner 内。self/subsidiary(active_confirmed=1) のドメインにのみ適用。

---

## H. 頻度階層（深さ別にコスト最適化）

| 頻度 | 内容 |
|---|---|
| 準リアルタイム | CT(crt.sh)ストリーム監視 → 新subdomain即取り込み |
| 日次 | passive列挙 + 解決 + takeover + TLS + IntelX露出 |
| 週次 | active brute + permutation + netblock掃引 + nuclei フル |
| 月次 | シード拡張(B-1)再走・baseline棚卸し・退役判定 |

---

## I. 未決事項 / 次アクション

- [ ] confidence の重み(w/p)初期値と確信閾値の決定
- [ ] takeover 判定の指紋辞書（対象サービス一覧）の選定
- [ ] nuclei テンプレの許可カテゴリ（intrusiveを除外するか）
- [ ] baseline の初回自動生成 vs 全手動承認
- [ ] risk_score の関数形（線形加重 or 重大度上限）
- [ ] Actions 週次ジョブの実行時間（無料枠分の消費見積り）
- [ ] シード拡張で他社を誤登録しない承認フロー(B-1)

---

*v0.2 — active/owned スコープの深さ・正確さ・継続評価。v0.1 と併用。*
