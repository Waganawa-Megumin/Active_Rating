# SETUP — ガイド付きプロビジョニング手順

本番デプロイに必要な外部リソース（Cloudflare / GitHub / API キー）を、**ローカル検証を先に済ませてから**
順番に用意する。各フェーズの「あなたの操作」を実施し、出力の値を指定箇所に貼り付けていく。

---

## Phase A — ローカル検証（アカウント不要）

```bash
npm install
npm run db:apply:local -w worker
npm run seed:local     -w worker
npm test                     # 38 tests green
npm run build                # scanner + pages
```

- `workerd` が動く環境なら `scripts/verify-e2e.sh` で スキャン→差分→レーティング まで一括確認できる。
- **ここで「アカウント無しでもパイプラインが動く」ことを確認**してから次へ。

---

## Phase B — GitHub（リポジトリのみ）

1. リポジトリを作成し push。
2. `.github/workflows/ci.yml` が自動実行され、**secret 無しで緑**になることを確認（テストは全てオフライン）。

---

## Phase C — Cloudflare（あなたのアカウント）

> 各コマンドの後、私が「次にこれを実行 / この値をここへ」と案内します。

1. Cloudflare アカウント作成 → `npx wrangler login`（ブラウザで OAuth）。
2. `npx wrangler d1 create active_rating`
   → 出力の **`database_id`** を `worker/wrangler.toml` の `[[d1_databases]].database_id` に貼付。
3. `npm run db:apply:remote -w worker`（リモート D1 に全DDL適用）。
4. `npx wrangler r2 bucket create active-rating-evidence`
5. `npx wrangler queues create ar-reeval`
6. 署名鍵を生成しシークレット登録:
   ```bash
   openssl rand -hex 32                       # 出力を控える（GitHub にも使う）
   npx wrangler secret put INGEST_HMAC_SECRET # 上の値を貼付
   ```
7. `npx wrangler secret put ADMIN_TOKEN`（登録 Admin API 用の任意トークン）。
8. Slack Incoming Webhook を作成 → `npx wrangler secret put SLACK_WEBHOOK_URL`。
9. `npm run deploy -w worker` → デプロイ先 `https://active-rating.<subdomain>.workers.dev` を控える。

---

## Phase D — GitHub Actions Secrets（あなたのリポジトリ）

リポジトリ → Settings → Secrets and variables → Actions に登録:

| Secret | 値 |
|---|---|
| `INGEST_HMAC_SECRET` | Phase C-6 と**同一**の 32byte hex |
| `AR_INGEST_URL` | `https://active-rating.<subdomain>.workers.dev/ingest` |

その後、まず対象を登録:
```bash
ADMIN_TOKEN=<Phase C-7の値> \
  npm run register -w scanner -- --file targets.yaml --api https://active-rating.<subdomain>.workers.dev
```
次に `scan.yml` を Actions から `workflow_dispatch`:
- 初回は `offline=true`（本番 ingest への安全な dry-run）。
- 問題なければ `offline=false`（実 crt.sh スキャン）。
- デプロイ済み worker の `/api/changes` と Slack 通知を確認。

---

## Phase E — ダッシュボード（Cloudflare Pages）

```bash
VITE_API_BASE=https://active-rating.<subdomain>.workers.dev npm run build -w pages
npx wrangler pages deploy pages/dist
```

- 経営/アナリスト向けに **Cloudflare Access** で保護（無料枠）。
- 「Targets / 登録」タブから追加登録も可能（`ADMIN_TOKEN` を入力）。

---

## 単一 HMAC 鍵の要点

`INGEST_HMAC_SECRET` は **1回生成し 2箇所**（worker secret ＝ Phase C-6、GitHub secret ＝ Phase D）に
**同じ値**を入れる。これで scanner の署名と worker の検証が一致する。`ADMIN_TOKEN` は登録系専用で別物。

---

## 後続フェーズで追加提供いただくもの（都度ガイド）

| Phase | 必要な鍵/リソース |
|---|---|
| P3 | IntelX・HIBP、テストID/RoE 運用 |
| P4 | VT/GTI・DomainTools、（重大時）Recorded Future / Intel471 / CYFIRMA / BitSight |
| P5 | Anthropic・OpenAI（ダブルLLM。数値は決定論、LLM は批評のみ） |
| P6 | MaxMind・urlscan（Geo/魚拓） |
