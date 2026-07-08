# ASM 設計ドキュメント v0.5 — BitSight補完・タイムリーさ・気の利き・被覆拡張

v0.1〜v0.4 の続き。BitSight（外部セキュリティレーティング）を**広く浅い網**として取り込み、
自前ASMが **深さ・タイムリーさ・文脈（気の利き）・継続監視** で上書きする構図を定義。
併せて未設計の攻撃面（メール認証・タイポスクワット・露出データ・PKI等）を補う。

---

## A. BitSight の位置づけ — 補完と超克

### A-1. BitSightに任せる（自前より得意 or 十分）
| 領域 | 理由 |
|---|---|
| 第三者/サプライチェーンの**広域被覆** | 能動不可の相手を広くカバー（v0.1 passiveスコープの補強） |
| **侵害テレメトリ**（ボットネット感染・C2通信） | 自前で取りづらい観測データを持つ |
| 経営/取締役会向け**ベンチマークスコア** | 対外比較・報告に有効 |
| 帰属の**初期あたり付け** | IP空間マッピングの出発点（ただし要検証・§B） |

### A-2. 自前ASMで超える（BitSightが浅い/できない）
| 差別化軸 | BitSightの限界 | 自前ASMの上書き |
|---|---|---|
| **深さ** | 受動・集約スコア | 認証あり検証(T2)、MFA判定、VPN CVE/KEV、クレデンシャル/スティーラー相関、マルチサーフェス(v0.3/0.4) |
| **タイムリーさ** | 日次〜数日遅延、緩慢なスコア | **イベント駆動**：CT/KEV/漏洩ヒットで即時再評価(§C) |
| **気の利き** | 汎用スコア、文脈なし | crown-jewel加重・シグナル相関・アクション提示(§D) |
| **継続監視** | 集約値の推移 | 資産単位の状態＋変更ログ＋SLA(v0.1/0.2) |

> 原則: **BitSightは1アダプタ**として取り込み、自前findingsと**突き合わせる**（§B）。スコアは参照値、駆動は自前。

---

## B. BitSightアダプタ ＋ 不一致・被覆ギャップエンジン（気の利きの核①）

単に取り込むだけでなく、**BitSightと自前の差分そのものを信号化**する。

### B-1. 取り込み
- BitSight API から 自社＋ツリー各社の risk vector 所見（TLS/SSL, パッチ, オープンポート, メール認証, 侵害等）と資産一覧を取得 → `bitsight_findings`
- ※取得できる粒度・API範囲は契約Tier依存。実装前に利用可能フィードを確認。

### B-2. 突き合わせ（disagreement = 信号）
```
compare(bitsight_assets, own_assets):
  - BitSightにあり自前になし → 被覆ギャップ(自前スキャン漏れ) or 帰属誤り候補
        → 自前で能動確認 → 実在なら資産化 / 他社なら帰属補正
  - 自前にありBitSightになし → 自前の深さ優位を記録(報告価値)
  - 両方にあるが所見不一致(例: BitSight=ポート閉/自前=開) → 鮮度差 → 要検証

compare(bitsight_finding, own_finding on same asset):
  - BitSightが古い/誤り → 自前の即時所見で上書き、鮮度差をメトリク化
```
- **帰属補正**: BitSightが他社IPを自社に誤マップ → 自前のASN/証明書Org/whois照合(v0.2 §C)で訂正。これはBitSightにない「気の利き」。

---

## C. タイムリーさ — イベント駆動再評価アーキ（差別化の核②）

日次バッチだけでなく、**外部イベントで該当資産だけを即時再評価**する。

| トリガ | ソース | 即時アクション |
|---|---|---|
| 新規サブドメイン/証明書 | **CT(crt.sh)ストリーム** | 即取り込み→resolve→評価 |
| 新規KEV掲載 / EPSS急騰 | CISA KEV / EPSSフィード | 該当product/versionの資産を**即再スコア**→該当あればcritical通知 |
| 漏洩/スティーラーlog新着 | IntelX / leak feed | 該当ドメイン資産と即相関(v0.3 §C) |
| BitSight所見更新 | BitSight webhook/poll | 突き合わせ(§B)→必要時 能動確認 |
| タイポスクワット新規登録 | CT / newly-registered-domains | ブランド近似判定→フィッシング疑い即通知(§E-2) |

```
Worker cron(高頻度) + queue:
  feedを監視 → 影響資産をindexで即引き当て → 対象のみ再評価キュー投入
  → スコア更新 → 差分あればSlack即時
```
- **肝**: 「全再スキャン」ではなく **影響資産のピンポイント再評価**。無料枠でも即時性を出せる。
- メトリク: **MTTD（検知までの時間）** を計測し、BitSight遅延との差を可視化＝優位の定量化。

---

## D. 気の利き — 文脈加重プライオリタイゼーション（核③）

汎用スコアでなく、**自社の文脈で「今効く一手」**を出す。

### D-1. クラウンジュエル加重
- 資産に `criticality`（事業重要度）と `data_sensitivity` を付与
- VPN・認証基盤・決済・個人情報保持系は高加重
- 同じCVEでも crown-jewel 上なら優先度を引き上げ

### D-2. シグナル相関（BitSightにできない多因子結合）
```
高優先の合成例:
  vpn_asset(crown-jewel)
  ∧ version脆弱(KEV掲載)
  ∧ クレデンシャル漏洩あり(§v0.3 C)
  ∧ MFA=absent/conditional(§v0.4 C)
  → "初期侵入が現実的" として最上位、根拠付きで提示
```
- BitSightは各vectorを独立スコア化するだけ。**結合して初期侵入の現実味を語る**のが差。

### D-3. アクション指向ダイジェスト
- 「スコアが下がった」でなく **「何が・なぜ・次に何を」** をLLM(v0.3 §E, 二重照合)で要約
- ノイズ抑制: debounce(v0.2)・パーキング/CDN除外・candidate足切りで、**出す所見を絞る**
- 組織ツリー単位で「今週の要対応 上位N」を提示

---

## E. 被覆拡張 — 未設計の攻撃面（「何か足りないか」への回答）

BitSightが浅い/欠く領域を自前で深掘り。

### E-1. メール認証・なりすまし面（BEC/フィッシング対策）
| 項目 | 深掘り観点 |
|---|---|
| SPF | 存在/構文/`~all`vs`-all`/lookup超過 |
| DKIM | セレクタ発見/鍵長/失効 |
| **DMARC** | `p=none/quarantine/reject`/rua-ruf/アライメント |
| DNSSEC | 署名有無/チェーン |
| MTA-STS / TLS-RPT | 存在/policy |
| BIMI | 有無(なりすまし耐性の副次) |
→ サブドメイン単位まで評価（親はrejectでも子が野放し、が典型穴）。`finding_type='email_auth'`

### E-2. タイポスクワット / ブランド保護
- CT・newly-registered-domain監視でブランド近似ドメインを検出（レーベンシュタイン/homoglyph/combosquat）
- 近似ドメインの**MXやログインページ出現＝フィッシング準備**として即時通知(§C)
- 稼働中フィッシング面はテイクダウン起票の材料に。`finding_type='typosquat'`

### E-3. 露出データサービス・シークレット
| 対象 | 検知 |
|---|---|
| 露出DB | Elasticsearch/Mongo/Redis/PG等の無認証公開 |
| 露出ダッシュボード | Grafana/Kibana/Jenkins/管理UI |
| クラウドストレージ | 公開S3/GCS/Azure Blob |
| コード/秘密 | 公開リポの鍵・`.env`・`.git`露出(v0.2 B-7強化) |
`finding_type='exposed_service'`（crown-jewel隣接なら即高）

### E-4. 証明書・PKI衛生
- 失効間近/失効、弱鍵(RSA<2048)、wildcard濫用、mis-issuance、短命証明書の監視
- CTを継続監視し**想定外発行**（影の証明書＝影のホスト）を検知。`finding_type='pki'`

### E-5. 侵害テレメトリ（ここはBitSight依拠）
- ボットネット感染・C2通信の兆候はBitSightのデータを取り込み、自前の露出/脆弱性と相関
- 「脆弱なVPN × 同IPレンジで感染兆候」= 侵害進行の疑いとして最上位

### E-6. 集中リスク（サプライチェーン4th-party）
- 観測techやCDN/SaaS依存から、**複数子会社が同一ベンダに依存**する集中点を抽出
- 単一障害・単一侵害の波及範囲を可視化（BitSightの第三者スコアを補完）

### E-7. アタックパス文脈（防御的プライオリタイズ）
- 露出＋脆弱性＋クレデンシャル＋MFA欠如を連結し、**もっともらしい初期侵入経路**を提示
- 実攻撃でなく「どこから入られ得るか」を根拠に改修順序を決める

---

## F. 継続モニタリングの強化（再確認）

- 資産/所見はSLA付きライフサイクル(v0.2/0.4)で追跡、超過は再通知
- attack surface size / findings件数 / MTTD / BitSightとの鮮度差 を時系列(risk_scores)でチャート化
- **BitSightスコア vs 自前risk_score** を並置し乖離を監査（自前が先に検知＝優位の証跡）

---

## G. データモデル追加（v0.4 §G への差分）

```sql
-- BitSight取り込みと突き合わせ
CREATE TABLE bitsight_findings (
  id          TEXT PRIMARY KEY,
  org_id      TEXT REFERENCES organizations(id),
  asset_ref   TEXT,                 -- BitSight側の資産識別
  vector      TEXT,                 -- tls/patching/open_ports/compromised/email_auth...
  grade       TEXT,
  detail_json TEXT,
  observed_at TEXT NOT NULL,
  reconciled  TEXT DEFAULT 'pending' -- matched/gap/attribution_error/stale
);

-- 資産の文脈(気の利きの加重材料)
ALTER TABLE assets ADD COLUMN criticality      TEXT DEFAULT 'unknown'; -- crown/high/med/low
ALTER TABLE assets ADD COLUMN data_sensitivity TEXT DEFAULT 'unknown';

-- タイムリーさの計測
CREATE TABLE detection_latency (
  id         TEXT PRIMARY KEY,
  finding_id TEXT REFERENCES findings(id),
  trigger    TEXT,                  -- ct/kev/leak/bitsight/scheduled
  event_at   TEXT,                  -- 外部イベント発生
  detected_at TEXT,                 -- 自前検知
  mttd_sec   INTEGER,
  bitsight_seen_at TEXT             -- BitSightが見た時刻(比較用)
);

-- 拡張被覆のfindingは既存findings.finding_typeで表現:
--   email_auth / typosquat / exposed_service / pki / concentration / attack_path
```

---

## H. イベント駆動ループ（統合像）

```
[定期] 日次/週次スキャン(v0.1-0.4)  ┐
[イベント] CT/KEV/EPSS/leak/BitSight ┤→ 影響資産をindex引当→ピンポイント再評価
                                     ┘        ↓
   確信度/帰属(v0.2) → 深さ評価(v0.3) → アセスメント(v0.4)
        ↓
   BitSight突き合わせ(§B) + 拡張被覆(§E)
        ↓
   文脈加重プライオリタイズ(§D) → MTTD計測(§C)
        ↓
   findings/SLA → LLMダイジェスト → Slack(critical即時/週次要対応上位N)
```

---

## I. 未決事項 / 次アクション

- [ ] BitSight APIの利用可能フィード/粒度の確認（契約Tier）
- [ ] 突き合わせの一致キー（BitSight資産IDと自前assets.identityのマッピング）
- [ ] イベント駆動のキュー基盤（Workers Queues 無料枠 or D1ポーリング）
- [ ] criticality/data_sensitivity の付与運用（誰がcrown-jewel指定するか）
- [ ] タイポスクワット判定アルゴリズム（homoglyph/しきい値）とテイクダウン連携
- [ ] メール認証評価のサブドメイン網羅方式
- [ ] MTTDダッシュボードの指標定義（BitSight比較の見せ方）

---

*v0.5 — BitSight補完＋イベント駆動タイムリーさ＋文脈プライオリタイズ＋被覆拡張。v0.1〜v0.4と併用。*
