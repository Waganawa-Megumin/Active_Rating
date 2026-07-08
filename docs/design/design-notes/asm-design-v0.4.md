# ASM 設計ドキュメント v0.4 — アセスメント層（VPNペネトレ的評価 / MFA判定 / ポータルUX）

v0.1〜v0.3 の続き。受動観測を超えて **実際に検証する（assessment / pen-test informed）** 層。
対象は自社グループ所有のVPNを中心とする。可用性が事業直結なので、
**認可・スコープ・保守窓・非破壊・レート制御**を最優先ガードとする。

> 姿勢: 方法論とテストケース設計に徹する。武器化した攻撃コードは扱わない。
> 実証は「自社所有 + 書面認可(RoE) + 変更管理番号 + 保守窓」でのみ。

---

## A. アセスメント成熟度（4段階ゲート）

段階を上げるほど侵襲的になる。各段の**前提条件**を満たさないと次に進めない。

| Tier | 内容 | 前提条件 | 例 |
|---|---|---|---|
| **T0 受動** | 外部インデックス照会のみ | なし | Shodan/Censys/IntelX（v0.1-0.3） |
| **T1 非侵襲能動** | 実ホストへ軽い正規リクエスト | 自社所有確定 | 指紋採取, TLSスキャン, ログインページ観察 |
| **T2 認証あり** | **テストアカウント**で正規ログインフロー検証 | 専用テストID発行・RoE | MFAフロー実地確認, セッション検証 |
| **T3 侵襲的実証** | 既知脆弱性のPoC検証 | RoE＋変更番号＋保守窓＋隔離優先 | CVE再現の限定確認 |

- **既定は T0/T1**。T2/T3 は資産ごとに明示フラグ（`assess_tier_allowed`）で許可。
- T3 でも **DoS・データ破壊・実データ持ち出しは禁止**。再現確認は最小侵襲・即復旧。

---

## B. VPN アセスメント・テストケース目録（ペネトレ観点）

カテゴリごとに「何を確かめるか／必要Tier／判定」を定義。実行は上記ゲートに従う。

### B-1. 認証まわりのレジリエンス
| テスト | 何を見るか | Tier | 備考 |
|---|---|---|---|
| レート制限/ロックアウト | 連続失敗で抑制/ロックされるか | T2 | **少数・制御下**で確認。総当りは禁止 |
| MFA強制 | 一次認証後に第二要素が必須か | T2 | §D で詳述 |
| ユーザ列挙 | 応答差で有効ユーザが判るか | T1 | エラーメッセージ/タイミング差 |
| CAPTCHA/ボット対策 | 自動化耐性の有無 | T1/T2 | 有無の観測のみ |
| クレデンシャルスタッフィング耐性 | 既知漏洩ペアの通用可否 | — | **本番で実行しない**。漏洩相関(v0.3 §C)＋制御有無で評価 |
| デフォルト/弱認証 | 初期IDや弱ポリシー | T2 | テストIDで |

> 総当り・スタッフィングの実施は不可。「制御が存在し機能するか」を最小テストと設定確認で判定する。

### B-2. セッション管理
| テスト | 何を見るか | Tier |
|---|---|---|
| セッション固定/再利用 | ログイン前後でトークン再生成されるか | T2 |
| タイムアウト | アイドル/絶対タイムアウトの有無 | T2 |
| ログアウト無効化 | ログアウトでサーバ側失効するか | T2 |
| トークン露出 | Citrix Bleed型の漏洩兆候 | T1/T3 |
| 同時セッション制御 | 多重ログイン制限 | T2 |

### B-3. トランスポート/設定
| テスト | 何を見るか | Tier |
|---|---|---|
| TLS健全性 | プロトコル/暗号/期限/鎖 | T1 |
| レガシープロトコル | PPTP, IKEv1 aggressive(PSKハッシュ露出), SSLv3 | T1 |
| 証明書 | 自己署名(本番)/CN不一致/弱鍵 | T1 |
| HTTPヘッダ | HSTS/クリックジャッキング防御 | T1 |
| 管理I/F分離 | 管理面が外部到達不可か | T1 |

### B-4. 既知脆弱性の実証（版ベース→限定確認）
- v0.3 §B の版→CVE→KEV/EPSS を入口に、**T3許可資産のみ**で最小侵襲の再現確認
- 破壊的PoCは不可。到達性・バージョン応答レベルでの確認を優先
- 結果は `finding(finding_type='vpn_cve', verified='confirmed|version-only')`

### B-5. 情報開示 / ロジック
| テスト | 何を見るか | Tier |
|---|---|---|
| 版/内部ホスト名漏洩 | エラーページ/ヘッダ/JS | T1 |
| ポータル添付リソース | 露出したヘルプ/設定ファイル | T1 |
| SAML/OIDC実装不備 | リプレイ/署名検証(認可時) | T2/T3 |

---

## C. MFA 判定（明示要望）

外部観察だけでは**確定困難**。二段構えで精度を上げる。

### C-1. 外部シグナル（T1・推定）
- **フェデレーション兆候**: ログインが SAML/OIDC で **外部IdP（Azure AD/Okta等）へリダイレクト** → IdP側でMFA強制の可能性大（`mfa_state='likely-idp'`）
- ポータル種別: FortiToken/RSA/DUO 等の**第二要素UI要素**の有無
- ログインページの JS/フォーム構成に MFA 入力欄が組み込まれているか
- ※これらは「兆候」であり**強制の確証ではない**（条件付きMFA等を見落とす）

### C-2. 実地確認（T2・確証）
```
テストID(第二要素登録済み) で正規ログイン:
  一次認証成功 →
     第二要素チャレンジが必須で提示される → mfa_state='enforced'
     チャレンジなしでセッション発行         → mfa_state='absent' (要是正: high)
  条件分岐(社内IP/端末で免除)があるかも観察 → mfa_state='conditional'
```
- **判定粒度**: enforced / conditional / likely-idp / absent / unknown
- absent と conditionalの穴（信頼ネットワーク扱いのバイパス等）は **finding化**
- **重要**: 全ログイン面で揃っているか（§Eのマルチサーフェス）を必ず確認。PC portalはMFAでもモバイルやレガシー面が素通り、が典型的な穴。

---

## D. ポータルUXアセスメント（PC / モバイル / ネイティブ）

「セキュリティ制御が**全サーフェスで一貫しているか**」をUX観点で評価。UXの穴が制御バイパスや不正利用を招く。

### D-1. 評価対象サーフェス
| サーフェス | 具体 | 固有の着眼 |
|---|---|---|
| **PCブラウザ** | デスクトップ版ポータル | 標準の制御ベースライン |
| **モバイルブラウザ** | レスポンシブ/別モバイルポータル | 別ポータルは**制御が退行しがち**（MFA/タイムアウト差） |
| **ネイティブクライアント** | FortiClient / GlobalProtect / AnyConnect / NetExtender | 証明書ピンニング, 保存資格情報, 端末信頼 |

### D-2. サーフェス横断チェック
| 項目 | 何を見るか | 判定 |
|---|---|---|
| **MFA一貫性** | 3面すべてでMFA強制か | 1面でも素通り=high |
| セッションタイムアウト一貫性 | モバイルで極端に長くないか | 逸脱=med |
| 資格情報の保存挙動 | password欄autocomplete, アプリ内保存 | 平文/無制限保存=med |
| 証明書ピンニング(アプリ) | MITM耐性 | 欠如=med |
| クリックジャッキング防御 | frame埋め込み可否 | 欠如=low〜med |
| モバイル専用エンドポイント | PC面にない旧APIが露出 | 露出=要精査 |
| セッション引き継ぎ | ブラウザ↔アプリ間のトークン扱い | 露出=med |
| エラー/文言の情報量 | 版・内部情報の露出 | 過多=low |

### D-3. UX観点の“安全性”
- 過度に短い/長いタイムアウト、分かりにくいログアウト → ユーザの回避行動（共有端末放置等）を誘発 → リスク
- モバイルで「記憶する」がデフォルトON等、**便利さと安全のトレードオフ**の設定を棚卸し
- 判定は `finding(finding_type='vpn_ux', surface='pc|mobile|native')`

---

## E. マルチサーフェス相関（穴の発見器）

各サーフェスの制御マトリクスを作り、**不一致＝攻撃者が狙う最弱点**として抽出。

```
control_matrix[asset] = {
  pc:     {mfa, timeout, headers, ...},
  mobile: {mfa, timeout, headers, ...},
  native: {mfa, pinning, stored_cred, ...}
}
→ 面間で制御が不一致な項目を diff → finding(severity=面数と重要度で決定)
例: pc.mfa=enforced かつ mobile.mfa=absent → critical
```

---

## F. 安全ガード（再掲・厳守）

- 認可(RoE)・スコープ・**保守窓・変更番号**なしにT2/T3を実行しない
- **総当り/スタッフィング/DoS/データ破壊/実データ持ち出しは禁止**
- レート制御必須、テストは最小回数・即復旧
- テストIDは専用発行、権限最小、検証後失効
- 生資格情報は保存しない（v0.3 §G）

---

## G. データモデル追加（v0.3 §G への差分）

```sql
-- 資産ごとの許可Tier
ALTER TABLE vpn_assets ADD COLUMN assess_tier_allowed TEXT DEFAULT 'T1'; -- T0..T3
ALTER TABLE vpn_assets ADD COLUMN mfa_state TEXT DEFAULT 'unknown';       -- enforced/conditional/likely-idp/absent/unknown

-- アセスメント実行(認可の記録込み)
CREATE TABLE assessments (
  id           TEXT PRIMARY KEY,
  asset_id     TEXT NOT NULL REFERENCES assets(id),
  tier         TEXT NOT NULL,           -- T0..T3
  roe_ref      TEXT,                    -- 認可/RoE番号
  change_ticket TEXT,                   -- 変更管理番号
  window_start TEXT, window_end TEXT,
  operator     TEXT,
  started_at   TEXT NOT NULL, ended_at TEXT
);

-- テストケース結果
CREATE TABLE assess_results (
  id           TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessments(id),
  category     TEXT NOT NULL,           -- auth/session/transport/vuln/disclosure/mfa/ux
  test_case    TEXT NOT NULL,
  surface      TEXT,                    -- pc/mobile/native/-
  result       TEXT NOT NULL,           -- pass/fail/na/needs-review
  severity     TEXT,
  evidence_json TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_assessres_cat ON assess_results(category, result);

-- サーフェス制御マトリクス(相関用)
CREATE TABLE surface_controls (
  asset_id  TEXT NOT NULL REFERENCES assets(id),
  surface   TEXT NOT NULL,              -- pc/mobile/native
  controls_json TEXT NOT NULL,          -- {mfa, timeout, pinning,...}
  observed_at TEXT NOT NULL,
  PRIMARY KEY (asset_id, surface)
);
```

---

## H. 評価ループ統合（VPN 1サイクル）

```
T0/T1: 指紋・版・TLS・ヘッダ・外部MFAシグナル・UX(非侵襲) → assess_results
  ↓ (assess_tier_allowed >= T2 の資産のみ)
T2: テストIDでMFA/セッション/ユーザ列挙/サーフェス横断 → mfa_state確定, surface_controls
  ↓ (T3許可 & 保守窓)
T3: 既知CVEの最小侵襲確認 → finding verified=confirmed
  ↓
マルチサーフェス相関(E) → 不一致finding
  ↓
vpn_priority再計算(v0.3 §B-3, mfa_state/UX/verified を加味) → SLA
  ↓
LLMトリアージ(v0.3 §E, 二重照合) → Slack(critical即時/他サマリ)
```

---

## I. 未決事項 / 次アクション

- [ ] RoE/変更番号を伴うT2/T3の承認ワークフロー（誰が許可するか）
- [ ] テストIDの発行・失効の自動化とスコープ最小化
- [ ] MFA判定シグナル辞書（製品別の第二要素UI・SAMLリダイレクト検出）
- [ ] ネイティブクライアントのピンニング/保存資格情報の検査方式
- [ ] surface_controls の収集方法（モバイルUA/別ポータルの巡回）
- [ ] レート制御の閾値（本番可用性を守る上限）
- [ ] assess_resultsのseverity→vpn_priorityへの反映係数

---

*v0.4 — VPN中心のアセスメント層（ペネトレ観点/MFA判定/ポータルUX PC・モバイル・ネイティブ）。認可・非破壊前提。v0.1〜v0.3と併用。*
