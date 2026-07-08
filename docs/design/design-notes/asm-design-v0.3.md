# ASM 設計ドキュメント v0.3 — VPNエッジ集中評価（自社グループ / 防御的）

v0.1・v0.2 の続き。**自社グループ所有のVPNゲートウェイ**に的を絞った集中評価。
インターネット面のVPNは初期侵入経路の最上位（ランサム・国家系の常套）なので、
**脆弱性・クレデンシャル露出・設定不備**を横断的に、かつ継続的に評価する。

> スコープ: self / subsidiary（100%保有・active確定）のみ。
> 姿勢: **防御的**。バージョン特定→既知CVE照合→優先度付け→改修指示まで。
> エクスプロイトの実行手順は扱わない。侵襲テストは許可済み保守窓のみ（§F）。

---

## A. VPNエッジの発見・指紋採取

まず「どのホストがVPNか・製品と版は何か」を非侵襲で確定する。

### A-1. 主要製品と識別サイン（指紋）
| 製品 | 代表ログインパス / サイン | 補助指紋 |
|---|---|---|
| Fortinet FortiGate SSL-VPN | `/remote/login` | favicon mmh3, FortiOSビルド文字列, Server/Cookie |
| Citrix ADC / NetScaler Gateway | `/vpn/index.html`, `/logon/LogonPoint` | version path, NSC_ cookie, favicon |
| Ivanti Connect Secure (旧Pulse) | `/dana-na/`, `welcome.cgi` | DSID cookie, ビルド番号 |
| Palo Alto GlobalProtect | `/global-protect/login.esp`, `/ssl-vpn/` | portal JS版, cert SAN |
| Cisco ASA / AnyConnect | `/+CSCOE+/`, webvpn logon | favicon, `X-Cisco` |
| SonicWall SMA / NetExtender | `/cgi-bin/welcome` | portalテーマ, cert |
| Check Point Mobile Access | `/sslvpn/`, SNX | cookie, cert |
| OpenVPN AS / WireGuard / IPsec | TCP443 portal / UDP1194 / UDP51820 / IKE UDP500,4500 | JARM, IKE応答 |

### A-2. 非侵襲な指紋手法
- favicon **mmh3ハッシュ** による製品同定（Shodan/Censys相関）
- 既知ログインパスへの **GET 応答パターン**（存在/リダイレクト/エラーページ）
- **TLS**: 証明書CN/SAN傾向、**JARM/JA3S** フィンガープリント
- ポータルHTML/JSの**ビルド文字列・版番号**抽出
- ポート面: 443ポータルに加え IKE(500/4500), OpenVPN(1194), WireGuard(51820), PPTP(1723), L2TP(1701)

→ 該当ホストは `entity_type='vpn'` として資産化し、`product`/`version`/`confidence`（v0.2 §C）を付与。

---

## B. 脆弱性評価（版ベース・非侵襲）

**版特定 → 既知CVE照合 → KEV/EPSSで優先度**。侵襲的PoCは投げない。

### B-1. CVE照合の考え方
- 検知は **nuclei の detection/version 系テンプレ**と**版→CVEマッピング**で行う（exploit系タグは本番に投げない）
- **権威ソース**: NVD / ベンダPSIRT / **CISA KEV**（実際に悪用中）/ **EPSS**（悪用確率）
- 本書のCVE列挙は代表例であり、**真の一覧はライブのKEV/NVDフィードで更新**する（下表は初期辞書の種）

### B-2. VPNで悪用歴の多い代表CVE（初期辞書の種 / 要ライブ更新）
| 製品 | 代表CVE（悪用歴あり） | 種別 |
|---|---|---|
| Fortinet | CVE-2018-13379, 2022-42475, 2023-27997, 2024-21762, 2024-55591 | 認証前パストラバーサル/RCE/認証バイパス |
| Citrix | CVE-2019-19781, 2023-3519, **2023-4966 (Citrix Bleed)** | RCE/セッショントークン漏洩 |
| Ivanti/Pulse | CVE-2019-11510, 2023-46805 + 2024-21887(連鎖), 2025-0282 | 認証バイパス+RCE |
| Palo Alto GP | CVE-2024-3400, 2019-1579 | コマンドインジェクション |
| Cisco ASA | CVE-2020-3452, 2018-0101, 2023-20269 | 情報漏洩/RCE |
| SonicWall | CVE-2021-20016, 2024-40766 | 認証バイパス |

> ※版が古い＝EOL/EOSは、CVE有無に関わらず**恒久リスク**として別枠で高評価。

### B-3. 優先度スコア（VPN特化）
```
vpn_priority =
    kev_hit        ? +40 : 0        # CISA KEVに載る=実悪用中、最優先
  + epss_score * 30                 # 悪用確率(0-1)
  + severity_cvss * 2               # CVSS
  + internet_exposed ? +15 : 0      # 直露出
  + credential_leaked ? +25 : 0     # 該当VPNのクレデンシャル漏洩(§C)と相関
  + eol_version ? +15 : 0
```
→ `findings`(v0.2 §E) に `finding_type='vpn_cve'` で記録、SLA付与。

---

## C. クレデンシャル露出（VPNは最有力の標的）

VPN資格情報は攻撃者の第一目標。露出を継続監視し、**該当VPNホストと相関**させる。

### C-1. 収集ソース
- **IntelligenceX**: leaks/pastes bucket をVPNポータルのドメイン・企業名で照会
- **HaveIBeenPwned**: ドメイン単位の漏洩、対象ユーザ群
- **スティーラーログ**（RedLine/Raccoon/Lumma系の流出）: **VPNのURL＋資格情報**がセットで載る特性 → VPNホスト名がログに出現していないか監視
- **コンボリスト/過去CVEの副産物**: CVE-2018-13379で流出した平文資格情報が今も出回る → 自社FortiGateが既知流出リストに含まれないか照合

### C-2. 相関ルール（高価値検知）
```
IF  leaked_credential.user ∈ 自社ドメイン
AND 対応する vpn_asset が active
AND （版が脆弱 OR MFA未確認 OR パッチ痕跡なし）
THEN finding(finding_type='vpn_cred_exposure', severity=critical)
```
- スティーラーログにVPN URLが出た場合は、**端末側侵害の疑い**として端末対応も促す注記を付す。

---

## D. 設定不備・衛生（非侵襲チェック）

外部から観測可能な範囲で設定不備を洗う。

| チェック | 観点 | severity |
|---|---|---|
| 管理I/Fの直露出 | 管理ポータル/SSHがVPNと同居して外部到達 | high |
| MFA未強制の兆候 | ポータル種別・認証フロー観察 | high |
| TLS健全性 | 期限切れ/自己署名(本番)/TLS1.0-1.1/弱cipher | med〜high |
| 版漏洩 | 詳細エラー/ビルド番号露出 | low〜med |
| レガシープロトコル | PPTP, IKEv1 aggressive(事前共有鍵ハッシュ露出), SSLv3 | high |
| ユーザ列挙 | ログイン応答差でユーザ有無が判る | med |
| EOL/EOS機器 | サポート終了版が稼働 | high |
| セキュリティヘッダ欠落 | ポータルのHSTS等 | low |

→ `findings(finding_type='vpn_misconfig')`。v0.2 §D-2 の baseline drift とも連動
（「このVPNは443のみ・TLS1.2+・MFA必須」を baseline 化し逸脱を検知）。

---

## E. LLM支援レイヤ（OpenAI + Claude API）

**トリアージ・相関・要約に使い、CVE/版の真偽はNVD/KEVで裏取り**（LLMを一次情報源にしない）。

### E-1. 適用箇所
| 用途 | 入力 → 出力 | 接地(grounding) |
|---|---|---|
| バナー/版正規化 | 雑多なバナー → {product, version, cpe} | 出力cpeをNVDで検証 |
| CVE候補の構造化 | 版 → CVE候補リスト | **必ずKEV/NVDで確認**、未確認は破棄 |
| 所見トリアージ | CVE+KEV+EPSS+クレデンシャル+資産重要度 → リスク説明と改修手順 | スコアは§B-3で算出、LLMは説明生成のみ |
| 設定監査の解釈 | 観測TLS/ヘッダ/ポータル特性 → 不備列挙と根拠 | チェック結果(§D)を根拠に |
| 相関要約 | 複数シグナル → 組織ツリー向けエスカレーション要約 | — |
| ノイズ整理 | 発見データのdedup/エンティティ解決 | — |

### E-2. 精度ガードレール（重要）
- **二重照合**: high/critical 候補は **OpenAIとClaudeの両方**に投げ、**不一致は human-review フラグ**（アンサンブルで幻覚CVEを排除）
- LLM出力の CVE-ID / CPE は**必ず外部DB照合**してからfindings化。照合不能は採用しない
- プロンプトに「不明なら不明と答え、CVEを推測生成しない」を明示
- コスト: high以上のみLLM相関を回す。日次の大量所見はスコアで足切り後に投入

### E-3. 実行場所
- Workers から OpenAI/Claude API を fetch（軽い要約・トリアージ）
- 重いバッチ相関は Actions 側。鍵は各Secret Storeで分離（`OPENAI_KEY`/`ANTHROPIC_KEY`）

---

## F. 非侵襲の原則（運用ガード）

- 既定は**版ベース検知＋非侵襲プローブのみ**（本番に exploit/intrusive テンプレを投げない）
- 実証が必要な場合は **許可済みの保守窓・変更管理番号付き**でのみ、隔離環境優先
- レート制御必須（VPNは可用性が事業直結、掃引で落とさない）
- スティーラーログ等の取得は自社資産の被害確認目的に限定

---

## G. データモデル追加（v0.2 §E への差分）

```sql
-- VPN資産の詳細
CREATE TABLE vpn_assets (
  asset_id      TEXT PRIMARY KEY REFERENCES assets(id),
  product       TEXT,              -- fortigate/netscaler/ivanti/globalprotect/asa...
  version       TEXT,
  cpe           TEXT,
  mfa_state     TEXT,              -- enforced/unknown/absent
  eol           INTEGER DEFAULT 0,
  jarm          TEXT,
  last_eval_at  TEXT
);

-- CVE照合結果（findingsを補強）
CREATE TABLE vpn_cve_refs (
  id          TEXT PRIMARY KEY,
  asset_id    TEXT NOT NULL REFERENCES assets(id),
  cve         TEXT NOT NULL,
  kev         INTEGER NOT NULL DEFAULT 0,   -- CISA KEV掲載
  epss        REAL,
  cvss        REAL,
  verified_by TEXT,                          -- nvd/kev/vendor
  detected_at TEXT NOT NULL
);
CREATE INDEX idx_vpncve_asset ON vpn_cve_refs(asset_id, kev);

-- クレデンシャル露出の相関
CREATE TABLE vpn_cred_exposure (
  id          TEXT PRIMARY KEY,
  asset_id    TEXT NOT NULL REFERENCES assets(id),
  source      TEXT NOT NULL,        -- intelx/hibp/stealer/combolist
  identifier  TEXT,                 -- user/ドメイン(生パスワードは保存しない)
  stealer_url_hit INTEGER DEFAULT 0,
  first_seen  TEXT NOT NULL
);
```
> 生パスワードは保存しない（ハッシュ/存在フラグのみ）。SQLCipher相当の暗号化を推奨。

---

## H. 評価ループ（VPN 1run）

```
discover/fingerprint(A) → version特定(confidence付与)
  → CVE照合(B): 版→候補→KEV/EPSS裏取り→vpn_cve_refs
  → クレデンシャル相関(C): IntelX/HIBP/stealer → vpn_cred_exposure
  → 設定不備(D): TLS/管理I/F/MFA/レガシー → misconfig findings
  → LLMトリアージ(E): high以上を二重照合→説明生成
  → vpn_priority算出(B-3) → findings/ SLA
  → risk_scores再計算(組織ツリー集約)
  → Slack: critical即時 / その他サマリ
```

## I. 頻度

| 頻度 | 内容 |
|---|---|
| 日次 | VPN指紋・版・クレデンシャル露出・TLS |
| 日次(フィード) | KEV/EPSS更新取り込み → 既存資産の再優先度付け |
| 週次 | 非侵襲nuclei（detection系）フル・設定不備精査 |
| 保守窓のみ | 侵襲的検証（許可時） |

---

## J. 未決事項 / 次アクション

- [ ] 対象VPN製品の指紋辞書（favicon mmh3 / パス / JARM）の初期セット確定
- [ ] KEV/EPSS/NVD フィード取り込み方式（Actions日次 or Workers cron）
- [ ] LLM二重照合の対象閾値（どのseverityから両モデルに投げるか）
- [ ] スティーラーログソースの選定と取り扱いポリシー
- [ ] MFA強制の外部からの推定可否・判定基準
- [ ] vpn_priority の重み初期値チューニング
- [ ] クレデンシャル保存の暗号化方式（SQLCipher / フィールド暗号）

---

*v0.3 — 自社グループVPNエッジの脆弱性・クレデンシャル・設定不備の集中評価。防御的・非侵襲前提。v0.1/v0.2と併用。*
