# Active Rating

> 能動検証で裏取りした、反証に耐えるアタックサーフェス評価プラットフォーム。
> 受動的で誤りだらけの Security Rating / ASM を、**証跡主義**で置き換える。

無料枠（GitHub Actions / Cloudflare）＋保有TI/評価APIで動くマルチテナントASM。
本リポジトリは統合設計 v1.0（`docs/design` の引き渡しセット）を実装したモノレポで、
現在 **Phase 1（基盤 ＋ 対象アセット登録システム）** が実装・検証済み。

## 4つの設計原則（実装中も逸脱しない）

| 原則 | 実装 |
|---|---|
| **証跡主義** 証跡なき評価を出さない | `evidence_bundles` 必須、before/after 正準JSON＋R2スナップショット、confidence未達は candidate |
| **能動検証** 推測でなく裏取り | active resolve/probe シグナル、帰属（ASN/cert/whois）で confirmed 昇格 |
| **タイムリー** イベント駆動 | 影響資産のみ Queue で即時再評価（`queue()`）、cron で CT/KEV ポーリング（P4で拡張） |
| **気の利き** 文脈で優先 | crown-jewel/criticality タグ、severity 加重 |

非破壊・認可: 第三者（supplier/partner/watch）へ能動スキャンしない。プロファイルはコードレベルで強制。

## アーキテクチャ

```
GitHub Actions (scanner)  ──HMAC──▶  Cloudflare Worker (worker)  ──▶  D1 + R2
  組織ツリー走査               /ingest 差分→証跡→評価→通知           構造化 + 証跡
  profile(active/passive)      /admin/* 登録   /dispute 反証
  crt.sh / offline fixtures    /api/*  read-only          ▲
                                                          │ fetch
                                            Cloudflare Pages (pages)
                                            3D地球儀 / ゲージ / CSFレーダー
                                            ベクター信号盤 / 反証KPI / 登録UI
```

## モノレポ構成（npm workspaces）

| package | 役割 |
|---|---|
| `shared/` | 型・HMAC署名・identity・正規化・confidence・zodスキーマ（scanner/workerがバイト同一で共有） |
| `scanner/` | Node CLI（GitHub Actions）。orchestrator・profileゲート・アダプタ・`register`（targets.yaml→Admin API） |
| `worker/` | Cloudflare Worker + D1 + R2 + Queue。`schema.sql`（全26テーブル）・差分エンジン・全ルート |
| `pages/` | React/Vite ダッシュボード（登録UI含む） |

## 対象アセット登録システム

スキャン対象（組織ツリー＋ドメイン）を登録・管理する3つの協調サーフェス:

1. **Admin API**（`worker`）— `POST /admin/orgs`・`/admin/domains`（Bearer `ADMIN_TOKEN`）。
   `active_confirmed` ゲートを強制（self/subsidiary のみ能動許可、監査記録）。
2. **登録UI**（`pages` の「Targets / 登録」タブ）— フォーム＋ツリーで org/domain を編集。
3. **GitOps**（`targets.yaml` ＋ `npm run register`）— 宣言的に一括 upsert。
   scanner は対象を D1（`/api/enrollment`）から取得（ハードコードしない）。

## ローカルで動かす（オフライン・無ネットワーク）

`crt.sh` の代わりに `fixtures/` を読む `OFFLINE=1` モードで、スキャン→差分→評価→ダッシュボードを一気通貫で動かせる。

```bash
npm install
npm run db:apply:local -w worker      # 全DDLをローカルD1へ
npm run seed:local     -w worker      # ベースライン投入（組織ツリー＋example.com資産）

# worker（別ターミナル）— workerd が動く環境が必要
INGEST_HMAC_SECRET=dev-secret ADMIN_TOKEN=dev-admin SLACK_ENABLED=0 OFFLINE=1 \
  npm run dev:worker                  # http://localhost:8787

# 登録（GitOps）＋ オフライン・スキャン
ADMIN_TOKEN=dev-admin npm run register -w scanner -- --file ../targets.yaml --api http://localhost:8787
INGEST_HMAC_SECRET=dev-secret AR_INGEST_URL=http://localhost:8787/ingest \
  npm run scan -w scanner -- --offline

curl -s localhost:8787/api/changes | jq         # ADDED/CHANGED/REMOVED
VITE_API_BASE=http://localhost:8787 npm run dev:pages   # http://localhost:5173
```

`scripts/verify-e2e.sh` が上記を一括実行する。

> 注: このリポジトリの CI・一部サンドボックスでは Cloudflare の `workerd` ランタイムが動かない場合がある。
> その環境でも **全ロジックは検証可能**: `npm test` は実 `schema.sql` に対する実SQLite上で差分エンジンと
> Hono アプリ（HMAC ingest・admin・dispute・api）をワーカ不要でテストする。

## テスト・型・ビルド

```bash
npm run typecheck   # 4 workspace すべて
npm test            # 38 tests（shared/scanner/worker）
npm run build       # scanner(esbuild) + pages(vite)
```

worker のテストは `better-sqlite3` 上の D1 シムで **実 `schema.sql`・実差分エンジン・実 Hono ルート**を
ワーカ不要で検証（`worker/test/*.integration.test.ts`）。

## デプロイ（ガイド）

`SETUP.md` を参照。ローカル検証（アカウント不要）→ CI 緑 → Cloudflare → GitHub Secrets → Pages の順で、
各ステップを対話ガイドで進める。

## ロードマップ

| Phase | 状態 | 内容 |
|---|---|---|
| **P1 基盤＋登録** | ✅ 実装済 | 組織ツリー・差分・証跡・反証・暫定レーティング・登録システム・可視化シェル |
| P2 深さ・正確さ | ⏳ | discovery 拡張・attribution・confidence 拡充 |
| P3 VPN＋アセスメント | ⏳ | VPN指紋/CVE照合・MFA状態機械・surface相関 |
| P4 TI＋タイムリーさ | ⏳ | adapters拡充・events・consensus・MTTD |
| P5 評価・レーティング | ⏳ | framework/vector/overall・ダブルLLM（数値は決定論・LLMは批評） |
| P6 Active Rating・魅せる | ⏳ | 反証自動撤回・FP率・globe/map/attackpath |

## ライセンス

独自プロプライエタリ（`LICENSE`）。著作権者 **waganawa-megumin**。
**プライベート利用限定・再配布禁止・AI/ML 学習利用禁止**。
