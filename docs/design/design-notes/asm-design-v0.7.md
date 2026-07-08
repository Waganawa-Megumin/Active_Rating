# ASM 設計ドキュメント v0.7 — "Active Rating" アイデンティティ・証跡主義・可視化(地球儀/世界地図)

v0.1〜v0.6 の続き。プロダクト名を **Active Rating** とし、その思想を設計原則に落とす。
併せて **経営層・アナリスト両方に刺さる可視化（3D地球儀・世界地図・アタックパスグラフ）** を定義。

---

## A. プロダクト・アイデンティティ — "Active Rating"

### A-1. 名前の含意
- **Active（能動）**: 受動観測の推測でなく、**能動検証で裏取りした**評価。ACD(Active Cyber Defense)の系譜。
- **Rating（評価）**: Security Ratingカテゴリ（BitSight等）に対する明確な対抗軸。
- 一言で: *受動的で誤りだらけの評価を、反証に耐える能動評価へ。*

### A-2. 解く痛み（悪質/低品質ASMのアンチテーゼ）
> 「嘘の情報を突きつけられ、その整理と反論に疲弊する」——を無くす。

| 悪質ASMの病理 | Active Rating の答え |
|---|---|
| 帰属誤り（他社資産を"あなたのもの"と断定） | **能動的に帰属検証**(v0.2 §C)、確定/推測を分離。誤りは自動撤回 |
| 誤検知の山でアナリストが疲弊 | debounce/相互確認/candidate足切り(v0.2/0.6)で**出す前に潰す** |
| 集約スコアで根拠不明 | **全評価に証跡バンドル**、ワンクリックで根拠提示 |
| 反論しても取り合わない | **反証モード**（§B-3）: 証跡チェーン提示 or 期限切れ証跡は即撤回 |
| 遅い | イベント駆動の即時性(v0.5 §C) |

---

## B. 思想が課す設計要件（証跡主義）

### B-1. 「証跡なき評価を出さない」原則
すべての rating 行 / finding は **evidence bundle** を必須で持つ。
```
evidence_bundle = {
  method: active_resolve|http_probe|tls_scan|cert_ct|urlscan_snapshot|ti_corroboration|assessment,
  proof:  { resolved_ip, http_status, screenshot_ref(urlscan魚拓), cert_sha256, ... },
  sources: [多ソース相互確認の内訳],       # v0.6 consensus
  confidence: 0-100,                       # v0.2
  observed_at, ttl,                        # 鮮度
}
```
- **urlscan の魚拓（スナップショット）** を証跡の中核に。「その時こう見えた」を保全。
- confidence未達(candidate)は rating に**採用しない**（内部追跡のみ）。

### B-2. 確信度と鮮度の常時可視化
- 各評価に confidence バッジと「最終確認 X時間前」を必ず表示。
- 鮮度切れ（ttl超過）は自動で "要再確認" へ降格。古い断定をしない。

### B-3. 反証モード（Dispute Handling）— 疲弊の元を断つ
```
第三者/被評価側が「これは誤り/うちのものでない」と主張:
  → 証跡バンドルを提示（帰属根拠: ASN/cert Org/whois, 観測時刻, スクショ）
  → 再検証を即実行:
       依然成立      → 証跡付きで維持
       成立せず/期限切れ → 自動撤回・ログ化(誤検知率メトリクスに反映)
```
- **誤検知率(FP rate)** を自社KPIとして計測・公開 → 「正確さ」を数字で主張。

---

## C. 可視化レイヤ — 魅せる(地球儀 / 世界地図)

経営の直感とアナリストの探索を両立。**美しさと証明可能性を両立**（誇張しない）。

### C-1. 3D地球儀（ヒーロービュー）
- ライブラリ: **globe.gl / three.js**（WebGL, Cloudflare Pages無料枠で動く）
- 表示レイヤ:
  | レイヤ | 内容 | データ |
  |---|---|---|
  | 自社攻撃面 | 資産をGeo配置（点の大きさ=criticality, 色=グレード） | MaxMind geo |
  | 脅威origin→自社 | 攻撃インフラ/C2から自社資産への**アーク** | TI(GTI/RF/AbuseIPDB) |
  | ライブイベント | 新規露出/漏洩ヒットが発生地点で明滅 | イベント駆動(v0.5) |
  | 組織ツリー | 親(日本)⇄子会社/サプライチェーン(海外)を線で | organizations |
- **アニメーション**: 新規criticalは発生時にアークが走る（"今これが起きた"を体感）。

### C-2. 世界地図（分析ビュー）
- ライブラリ: **MapLibre GL**（オープンソース・トークン不要）or **deck.gl**（大量点/アーク）
- ビュー:
  - **コロプレス**: 国/地域別の露出・リスク濃淡
  - **ヒートマップ**: クレデンシャル漏洩・フィッシングインフラの分布
  - 資産密度・侵害兆候の地理集中

### C-3. 精度と魅せの両立（Active Ratingらしさ）
- **確定帰属 vs Geo推測を色/形で明示**（IP GeoはCDN/クラウドで実体とズレるため）。
- 推測はハッチング等で「これは推定」と正直に描く。**綺麗だが嘘をつかない地球儀**。

---

## D. その他の魅せる要素

| ビジュアル | 目的 | 実装 |
|---|---|---|
| **Active Rating ゲージ** | 総合スコア(0–1000)を大きく＋トレンド矢印 | SVG/recharts |
| **CSFレーダー** | NIST CSF機能別の姿勢(v0.6 C) | recharts radar |
| **アタックパスグラフ** | 露出→脆弱性→クレデンシャル→資産の連鎖(v0.5 E-7) | react-force-graph / cytoscape |
| **MTTDレース** | 「BitSightより N日早く検知」を時系列で(v0.5 F) | D3 timeline |
| **ベクター信号盤** | 9ベクターのA–F信号灯(v0.6 D) | グリッド |
| **ライブフィード** | 直近イベントのティッカー | Workers SSE |
| **Before/After** | 改修による面積縮小を可視化 | 面積アニメ |

---

## E. 技術スタック（無料枠 / Cloudflare Pages）

```
Pages(静的) ── React ──┬─ globe.gl / three.js        (3D地球儀)
                       ├─ MapLibre GL / deck.gl      (世界地図・アーク)
                       ├─ recharts / D3              (ゲージ/レーダー/timeline)
                       └─ react-force-graph          (アタックパス)
   ↑ fetch (read-only)
Workers /api ── D1 (assets/findings/ratings/geo) + R2 (スクショ/証跡)
   ↑ 認証: Cloudflare Access(無料枠) で経営/技術ロール出し分け
```
- 地図タイルは**MapLibre＋無料/自前タイル**でMapboxトークン課金を回避。
- 地球儀のGeo点は事前集計してD1に持たせ、クライアントは軽量JSONをfetch（Workers CPU節約）。

---

## F. データモデル追加（v0.6 §G への差分）

```sql
-- 証跡バンドル(反証モードの土台)
CREATE TABLE evidence_bundles (
  id          TEXT PRIMARY KEY,
  finding_id  TEXT REFERENCES findings(id),
  method      TEXT NOT NULL,
  proof_json  TEXT NOT NULL,        -- resolved_ip/http_status/cert/...
  snapshot_ref TEXT,                -- urlscan魚拓/R2キー
  sources_json TEXT,                -- 相互確認内訳
  confidence  INTEGER,
  observed_at TEXT NOT NULL,
  ttl_sec     INTEGER
);

-- 反証・撤回ログ(FP率メトリクス)
CREATE TABLE disputes (
  id          TEXT PRIMARY KEY,
  finding_id  TEXT REFERENCES findings(id),
  claim       TEXT,
  outcome     TEXT,                 -- upheld/retracted
  revalidated_at TEXT,
  created_at  TEXT NOT NULL
);

-- 可視化用Geo(事前集計)
CREATE TABLE geo_points (
  asset_id    TEXT PRIMARY KEY REFERENCES assets(id),
  lat REAL, lon REAL,
  geo_source  TEXT,                 -- maxmind
  attribution TEXT,                 -- confirmed/estimated  ← 色分けの根拠
  grade       TEXT, criticality TEXT
);

-- 脅威アーク(origin→asset)
CREATE TABLE threat_arcs (
  id          TEXT PRIMARY KEY,
  src_lat REAL, src_lon REAL,
  dst_asset_id TEXT REFERENCES assets(id),
  ti_source   TEXT, severity TEXT,
  observed_at TEXT NOT NULL
);
```

---

## G. 経営ダッシュボード構成（1ページ→ドリルダウン）

```
[ヒーロー] 3D地球儀(攻撃面＋脅威アーク) ＋ Active Ratingゲージ(総合＋トレンド)
[上段]   ベクター信号盤(A–F) ／ CSFレーダー ／ MTTDレース(vs BitSight)
[中段]   今四半期の要対応 Top N（各行に confidence & 証跡リンク）
[下段]   FP率(正確さの証明) ／ 世界地図(漏洩・フィッシング分布)
   ↓ クリック
[技術ドリルダウン] finding → evidence_bundle(魚拓/帰属根拠) → 推奨アクション/SLA
```

---

## H. 未決事項 / 次アクション

- [ ] Active Rating スコア(0–1000)の対外開示ポリシー（自社のみ/被評価側にも見せるか）
- [ ] 地図タイル供給（自前ホスト vs 無料タイル）の選定
- [ ] 地球儀の点数が増えた時のクラスタリング/LOD方針
- [ ] 反証モードの受付導線（誰がdispute起票できるか）とSLA
- [ ] FP率の定義と目標値（正確さKPI）
- [ ] Cloudflare Access のロール設計（経営/アナリスト/監査）
- [ ] 証跡スナップショットのR2保存期間・コスト

---

*v0.7 — "Active Rating" 証跡主義＋反証モード＋地球儀/世界地図の可視化。v0.1〜v0.6と併用。*
```
```
