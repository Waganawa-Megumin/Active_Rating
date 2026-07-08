# ASM (Attack Surface Management) — 設計ドキュメント v0.1

無料枠（GitHub free / Cloudflare free）で回すマルチテナントASM。
「組織ツリー単位でドメインを登録 → 日次定点観測 → 差分をSlack通知＋タイムライン蓄積」。

- **スキャン実行**: GitHub Actions（重い列挙・API呼び出し）
- **差分・API・保管**: Cloudflare Workers + D1 + R2
- **可視化**: Cloudflare Pages（D1へfetch）
- **開発フロー**: Claude Chat → 本ドキュメント → Claude Code

---

## 1. 設計思想

1. **組織ツリーで管理**: parent → subsidiary / supplier / partner / watch を階層で持つ。
2. **オーナーシップでスキャン強度を自動切替**: 所有資産は能動、第三者は受動のみ。
3. **git的な差分**: 「現在状態(assets)」＋「append-onlyな変更ログ(changes)」。
4. **重い処理はActions、軽いdiffはWorkers**: 無料枠のCPU制限を回避。
5. **正規化してから比較**: 揮発フィールドを殺してノイズを消す。

---

## 2. アーキテクチャ

```
                ┌─────────────────────────────────────────┐
                │            GitHub Actions (cron)          │
                │  組織ツリーを走査 → ドメインごとにスキャン   │
                │  relation_typeでprofile(active/passive)決定│
                │  正規化スナップショットJSONを生成           │
                └───────────────┬──────────────────────────┘
                                │ POST /ingest (HMAC署名)
                                ▼
        ┌───────────────────────────────────────────────────┐
        │             Cloudflare Workers (API層)              │
        │  /ingest  … 差分計算 → changes追記 → assets更新      │
        │  /api/*   … ダッシュボード向け読み取りAPI            │
        │  cron     … 軽量ポーリング(CT等)・通知再送           │
        │           └─ 変更検知 → Slack Incoming Webhook       │
        └──────────┬─────────────────────────┬──────────────┘
                   │                         │
              ┌────▼────┐              ┌──────▼──────┐
              │   D1     │              │     R2      │
              │ 構造化   │              │ RAW結果保管  │
              │ 状態/差分 │              │ 再解析用     │
              └─────────┘              └─────────────┘
                   ▲
                   │ fetch (read-only API)
        ┌──────────┴──────────┐
        │  Cloudflare Pages    │  組織ツリー / 差分タイムライン / 資産一覧
        └─────────────────────┘
```

---

## 3. スキャンプロファイル（最重要の分岐）

`relation_type` によって使える手法を制限する。第三者への能動スキャンを設計レベルで禁止する。

| relation_type | 意味 | プロファイル | 使える手法 |
|---|---|---|---|
| `self` | 自組織 | **active** | 全手法（能動DNS, httpx, ポート照会, 受動全部） |
| `subsidiary` | 子会社（所有下） | **active** | 同上（要オーナーシップ確認フラグ） |
| `supplier` | サプライチェーン | **passive** | CT(crt.sh), IntelX, HIBP, Censys/Shodan既存データ照会のみ |
| `partner` | 提携先 | **passive** | 同上 |
| `watch` | 監視対象他社 | **passive** | 同上 |

- **active限定手法**: httpx（実際にリクエスト送出）, 自前ポートスキャン, DNSブルートフォース
- **passiveで完結する手法**: crt.sh(CT), Chaos, IntelX, HIBP, Censys/Shodan/Netlas の**既存インデックス照会**（新規スキャンをトリガしない読み取り）
- 子会社でも所有が曖昧な資産は `active_confirmed=false` として passive 扱いにフォールバック。

---

## 4. データモデル（D1 / SQLite DDL）

```sql
-- 組織ツリー（自己参照で親子・サプライチェーンを表現）
CREATE TABLE organizations (
  id            TEXT PRIMARY KEY,          -- ULID
  name          TEXT NOT NULL,
  parent_id     TEXT REFERENCES organizations(id),
  relation_type TEXT NOT NULL CHECK (relation_type IN
                  ('self','subsidiary','supplier','partner','watch')),
  active_confirmed INTEGER NOT NULL DEFAULT 0,  -- 能動スキャン許可の明示フラグ
  slack_channel TEXT,                       -- この組織の通知先(未設定は親を継承)
  notes         TEXT,
  created_at    TEXT NOT NULL
);

-- 監視シードドメイン
CREATE TABLE domains (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES organizations(id),
  fqdn       TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(org_id, fqdn)
);

-- 実行メタ（1スキャン=1行）
CREATE TABLE snapshots (
  id         TEXT PRIMARY KEY,
  domain_id  TEXT NOT NULL REFERENCES domains(id),
  source     TEXT NOT NULL,                 -- crtsh / intelx / censys ...
  profile    TEXT NOT NULL,                 -- active / passive
  run_at     TEXT NOT NULL,
  asset_count INTEGER NOT NULL DEFAULT 0
);

-- 現在状態（1行=1観測エンティティ, upsertで維持）
CREATE TABLE assets (
  id          TEXT PRIMARY KEY,            -- hash(domain_id||entity_type||identity)
  domain_id   TEXT NOT NULL REFERENCES domains(id),
  org_id      TEXT NOT NULL REFERENCES organizations(id),
  entity_type TEXT NOT NULL,               -- subdomain/dns/service/cert/web/exposure/asn
  identity    TEXT NOT NULL,               -- 安定識別キー(§5)
  attrs_json  TEXT NOT NULL,               -- 正規化済み属性
  first_seen  TEXT NOT NULL,
  last_seen   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' -- active / gone
);
CREATE INDEX idx_assets_domain ON assets(domain_id);
CREATE INDEX idx_assets_type   ON assets(entity_type);

-- 変更ログ（append-only, これがタイムライン兼監査ログ）
CREATE TABLE changes (
  id          TEXT PRIMARY KEY,
  domain_id   TEXT NOT NULL REFERENCES domains(id),
  org_id      TEXT NOT NULL REFERENCES organizations(id),
  asset_id    TEXT,
  entity_type TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('ADDED','REMOVED','CHANGED')),
  severity    TEXT NOT NULL DEFAULT 'info', -- info / low / med / high
  before_json TEXT,
  after_json  TEXT,
  detected_at TEXT NOT NULL,
  notified    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_changes_org  ON changes(org_id, detected_at);
```

---

## 5. エンティティ識別キーと監視属性

差分の質はキーの安定性で決まる。

| entity_type | identity（キー） | attrs（差分対象） |
|---|---|---|
| `subdomain` | FQDN | resolves, a[], aaaa[], cname |
| `dns`       | name + "|" + type | values[]（ソート） |
| `service`   | ip + ":" + port + "/" + proto | product, banner_hash, tls_sni |
| `cert`      | sha256 | sans[], issuer, not_after |
| `web`       | url | status, title, tech[], body_hash |
| `exposure`  | source + ":" + storageid | bucket, first_seen |
| `asn`       | cidr | org, asn |

---

## 6. 正規化ルール（誤検知対策）

比較前に必ず適用。

- レコード/配列は**ソート**してから比較（順序ゆらぎ除去）
- 小文字化、FQDN末尾ドット除去
- **無視するフィールド**: TTL, banner内タイムスタンプ, `Date`/`Server`日付, ヘッダ順序
- body は正規化後に**hash化**して比較（差分容量削減）
- IntelX結果は `storageid`/`systemid` で dedup

---

## 7. 差分アルゴリズム（擬似コード / Worker `/ingest`）

```
function ingest(domain_id, source, profile, normalized_entities[]):
  prev = SELECT * FROM assets WHERE domain_id=? AND entity_type IN (types of this source)
  prev_map = { a.identity: a for a in prev }
  seen = set()

  for e in normalized_entities:
     seen.add(e.identity)
     key = e.identity
     if key not in prev_map:
        upsert_asset(e, first_seen=now, last_seen=now, status='active')
        emit_change(ADDED, after=e.attrs, severity=severity_of(e, 'ADDED'))
     else:
        old = prev_map[key]
        if normalized(old.attrs) != e.attrs:
           update_asset(key, attrs=e.attrs, last_seen=now)
           emit_change(CHANGED, before=old.attrs, after=e.attrs,
                       severity=severity_of(e, 'CHANGED'))
        else:
           touch_last_seen(key, now)

  # このソースが網羅的な場合のみ REMOVED 判定（部分ソースでは消さない）
  if source.is_authoritative:
     for key in prev_map:
        if key not in seen:
           mark_asset_gone(key)
           emit_change(REMOVED, before=prev_map[key].attrs, severity='low')

  record_snapshot(domain_id, source, profile, count=len(entities))
  flush_notifications()   # §9
```

**severity_of の初期ルール例**
- 新規サブドメイン / 新規オープンサービス → `med`
- 新規 exposure(leaks bucket) → `high`
- 証明書notAfter接近・失効 → `med`
- REMOVED全般 → `low`

---

## 8. APIアダプタ

各アダプタは共通IF `fetch(domain, profile) -> normalized_entities[]` を実装。

| source | 種別 | profile | キー | 備考 |
|---|---|---|---|---|
| crt.sh | CT/subdomain/cert | passive | FQDN, sha256 | キー不要・主力 |
| Chaos (ProjectDiscovery) | subdomain | passive | FQDN | 公開データセット |
| subfinder | subdomain | passive | FQDN | Actions内で実行 |
| dnsx | dns/resolve | active | name|type | 能動解決 |
| httpx | web | **active** | url | selfのみ |
| IntelligenceX | exposure/whois | passive | storageid | 日次・新規のみ差分化 |
| HaveIBeenPwned | exposure | passive | breach name | ドメイン漏洩監視 |
| Censys | service/cert | passive(照会) | ip:port | 無料枠・既存index照会 |
| Shodan | service | passive(照会) | ip:port | 照会限定(列挙不可) |
| Netlas / LeakIX | service/exposure | passive | ip:port | 無料枠 |
| GreyNoise Community | reputation | passive | ip | ノイズ判定 |
| IPinfo / MaxMind | asn/geo | passive | cidr | エンリッチ用 |
| SecurityTrails / DNSlytics | dns履歴/逆引き | passive | name|type | DomainTools補完 |

### IntelligenceX アダプタ仕様
```
POST /intelligent/search  { term: <domain>, maxresults, buckets:[leaks,pastes,whois,darknet] }
  -> id
GET  /intelligent/search/result?id=<id>
  -> records[]
normalize: 各recordを {entity_type:'exposure', identity:'intelx:'+storageid,
                        attrs:{bucket, name, date, media}}
diff: 前回storageid集合との差分 → 新規のみ ADDED(severity=high if bucket=leaks)
```

---

## 9. Slack通知

- **Incoming Webhook**（無料）。組織ごとに `slack_channel` を持ち、未設定なら親組織を辿って継承。
- 送信単位は**スキャン実行ごとにバッチ集約**（1変更1通知にしない）。
- severity `med` 以上を即時、`low/info` は日次サマリにまとめる。
- メッセージ例:
  ```
  🛰 [ACME Corp > 子会社X] example.co.jp
  🆕 新規サブドメイン: staging.example.co.jp (A: 203.0.113.10)
  🔴 新規リーク検出: IntelX leaks bucket 3件
  🔁 証明書更新: *.example.co.jp notAfter 2026-09-01
  🕐 detected 2026-07-08 09:00 JST  |  詳細→ <pages_url>
  ```
- `changes.notified` フラグで再送防止。Worker cronが未通知を拾って再送。

---

## 10. スケジューリング

**GitHub Actions** (`.github/workflows/scan.yml`)
- `schedule: cron` 日次（例 00:00 UTC = 09:00 JST）
- matrix でドメインを分割し並列（分単位節約）
- profile分岐: `self/subsidiary(active_confirmed)` → activeジョブ、それ以外 → passiveジョブ

**Workers Cron Triggers**
- 6h毎: crt.sh(CT)ポーリング、未通知の再送
- 日次: `low/info` の日次サマリ送信

---

## 11. ディレクトリ構成

```
asm/
├─ scanner/                 # GitHub Actions側 (TypeScript/Node)
│  ├─ src/
│  │  ├─ adapters/          # crtsh.ts, intelx.ts, censys.ts, ...
│  │  ├─ normalize/         # エンティティ別正規化
│  │  ├─ profile.ts         # relation_type → active/passive
│  │  ├─ orchestrator.ts    # 組織ツリー走査→ドメイン→アダプタ実行
│  │  └─ ingest-client.ts   # POST /ingest (HMAC署名)
│  └─ package.json
├─ worker/                  # Cloudflare Workers
│  ├─ src/
│  │  ├─ index.ts           # ルーティング
│  │  ├─ ingest.ts          # 差分エンジン(§7)
│  │  ├─ diff.ts
│  │  ├─ notify-slack.ts    # §9
│  │  └─ api.ts             # /api/* 読み取り
│  ├─ schema.sql            # §4 DDL
│  └─ wrangler.toml
├─ pages/                   # ダッシュボード(静的)
│  └─ ...
└─ .github/workflows/
   └─ scan.yml
```

---

## 12. スケルトン

### `.github/workflows/scan.yml`
```yaml
name: asm-scan
on:
  schedule: [{ cron: '0 0 * * *' }]
  workflow_dispatch:
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
        working-directory: scanner
      - run: node dist/orchestrator.js
        working-directory: scanner
        env:
          INGEST_URL:  ${{ secrets.INGEST_URL }}
          INGEST_HMAC: ${{ secrets.INGEST_HMAC }}
          INTELX_KEY:  ${{ secrets.INTELX_KEY }}
          SHODAN_KEY:  ${{ secrets.SHODAN_KEY }}
          CENSYS_ID:   ${{ secrets.CENSYS_ID }}
          CENSYS_SECRET: ${{ secrets.CENSYS_SECRET }}
          HIBP_KEY:    ${{ secrets.HIBP_KEY }}
          # ...
```

### `worker/src/index.ts`（骨子）
```typescript
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/ingest' && req.method === 'POST') {
      if (!(await verifyHmac(req, env.INGEST_HMAC))) return new Response('bad sig', { status: 401 });
      return ingest(req, env);          // §7
    }
    if (url.pathname.startsWith('/api/')) return api(req, env);
    return new Response('ok');
  },
  async scheduled(_evt, env: Env) {
    await pollCT(env);                    // crt.sh
    await resendUnnotified(env);          // §9
  }
};
```

---

## 13. 無料枠の注意点

- **Workers**: 1リクCPU時間が短い → 差分は1ソース分ずつ小さく。大量ループはActions側。
- **D1**: 書き込み行数/日に上限 → **変更(changes)のみ書く**。touch系はバッチ。
- **Actions**: privateは月2,000分 → matrix並列＋passive/active分離で節約。
- **IntelX**: 検索クレジット制限 → 日次1回・ドメイン単位に限定、subdomain単位で回さない。
- **Shodan無料**: 列挙不可 → 既知IPの照会のみ。
- **HIBP**: 低額サブスク前提（ドメイン監視は価値大）。

---

## 14. 未決事項 / 次アクション

- [ ] ULID採番はscanner側かWorker側か
- [ ] `is_authoritative` なソースの確定（REMOVED判定を許すソース）
- [ ] Slackメッセージのブロックフォーマット確定
- [ ] Pagesの認証（Cloudflare Access無料枠 or Basic）
- [ ] 子会社の `active_confirmed` 運用フロー（誰が許可を付与するか）
- [ ] severityルールのチューニング

---

*v0.1 — Claude Code 引き渡し用初版*
