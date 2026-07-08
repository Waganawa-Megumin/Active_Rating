# SETUP — 全自動デプロイ（CLI操作なし）

デプロイ・スキャンは **GitHub Actions 上で全自動**で実行される（`deploy.yml` / `scan.yml`）。
あなたの作業は **GitHub のリポジトリ設定画面でシークレットを数個ペーストするだけ**（CLI 不要）。
それ以外（D1/R2/Queue 作成、schema 適用、worker/pages デプロイ、対象登録、定期スキャン）は
ワークフローが自動で行う。デプロイ失敗時のログ確認・修正は担当（Claude）が CI 経由で回す。

---

## あなたの唯一の作業 — リポジトリ Secrets を登録

GitHub リポジトリ → **Settings → Secrets and variables → Actions → New repository secret** で以下を追加:

| Secret | 値 | 取得元 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API トークン | Cloudflare ダッシュボード → My Profile → API Tokens。権限: Workers Scripts / D1 / R2 / Queues / Pages を **Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | アカウントID | Cloudflare ダッシュボード右サイドバー |
| `INGEST_HMAC_SECRET` | 署名鍵（担当が生成した値を貼付） | チャットで共有 |
| `ADMIN_TOKEN` | 登録API用トークン（担当が生成した値を貼付） | チャットで共有 |
| `SLACK_WEBHOOK_URL` | （任意）Slack Incoming Webhook | Slack App → Incoming Webhooks |

> `CLOUDFLARE_API_TOKEN` はセキュリティ上こちら（Claude）が保持すべきでないため、あなたのアカウントから
> 発行して GitHub Secret に貼ってください。`INGEST_HMAC_SECRET` / `ADMIN_TOKEN` の値は担当が生成して渡します。

登録後は担当が `deploy` ワークフローを起動し、成功するまで面倒を見る。あなたのCLI操作は不要。

---

## 自動実行される内容（`deploy.yml`）

1. D1 (`active_rating`) / R2 (`active-rating-evidence`) / Queue (`ar-reeval`) を冪等に作成
2. D1 `database_id` を解決して `wrangler.toml` に注入
3. リモート D1 に全DDL（`schema.sql`）を適用
4. worker シークレット（HMAC / ADMIN / Slack）を設定
5. worker をデプロイし、公開URL（`*.workers.dev`）を取得
6. `targets.yaml` を Admin API 経由で登録
7. ダッシュボード（Pages）をビルド＆デプロイ
8. 取得した worker URL を `deploy/state.env` にコミット（定期スキャンが参照）

## 定期スキャン（`scan.yml`）

- 毎日 09:00 JST に自動実行。`deploy/state.env` の URL を使い、署名付きで `/ingest` に投入。
- `workflow_dispatch` で手動起動も可（`offline=true` で fixtures ドライラン）。

## CI（`ci.yml`）

- push/PR で typecheck・test（38件・オフライン）・build を自動実行。シークレット不要。

---

## ダッシュボードの閲覧・保護

- Pages デプロイ後、`active-rating` プロジェクトのURLで閲覧可能。
- 経営/アナリスト向けに **Cloudflare Access**（無料枠）で保護推奨。
- 追加の対象登録は「Targets / 登録」タブから（`ADMIN_TOKEN` を入力）、または `targets.yaml` を編集して push
  （deploy 時に自動反映）。

---

## ローカルで動かしたい場合（任意・参考）

`workerd` が動くマシンなら `scripts/verify-e2e.sh` でローカル一気通貫も可能:

```bash
npm install
npm run db:apply:local -w worker && npm run seed:local -w worker
INGEST_HMAC_SECRET=dev ADMIN_TOKEN=dev SLACK_ENABLED=0 OFFLINE=1 npm run dev:worker
# 別ターミナル
ADMIN_TOKEN=dev npm run register -w scanner -- --file ../targets.yaml --api http://localhost:8787
INGEST_HMAC_SECRET=dev AR_INGEST_URL=http://localhost:8787/ingest npm run scan -w scanner -- --offline
VITE_API_BASE=http://localhost:8787 npm run dev:pages
```

---

## 後続フェーズで追加提供いただく鍵（都度ガイド）

| Phase | 鍵/リソース |
|---|---|
| P3 | IntelX・HIBP、テストID/RoE |
| P4 | VT/GTI・DomainTools、（重大時）Recorded Future / Intel471 / CYFIRMA / BitSight |
| P5 | Anthropic・OpenAI（数値は決定論、LLM は批評のみ） |
| P6 | MaxMind・urlscan |
