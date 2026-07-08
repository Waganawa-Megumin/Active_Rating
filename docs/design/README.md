# Active Rating — 設計ドキュメント引き渡しセット

能動検証・証跡主義のアタックサーフェス評価プラットフォーム。
無料枠（GitHub free / Cloudflare free）+ 保有TI/評価APIで構築するマルチテナントASM。

## 読む順番

**まず `active-rating-design-v1.0.md`（統合マスター仕様）** を読む。
全体アーキ・統合DDL・列挙辞書・ディレクトリ構成・ロードマップが一本化されている。
各サブシステムの設計背景は以下の分冊を参照。

| ファイル | 内容 |
|---|---|
| **active-rating-design-v1.0.md** | 統合マスター（これが本体。全DDL・列挙・ロードマップ） |
| asm-design-v0.1.md | マルチテナント基盤＋差分エンジン |
| asm-design-v0.2.md | 深さ・正確さ（確信度/帰属）・継続評価 |
| asm-design-v0.3.md | VPN脆弱性・クレデンシャル・設定不備 |
| asm-design-v0.4.md | アセスメント（ペネトレ観点/MFA判定/ポータルUX） |
| asm-design-v0.5.md | BitSight補完・イベント駆動タイムリーさ・被覆拡張 |
| asm-design-v0.6.md | TI統合・NIST CSF評価・レーティング・ダブルLLM |
| asm-design-v0.7.md | Active Ratingアイデンティティ・証跡主義・可視化 |

## Claude Code への渡し方

1. 本セットをリポジトリに配置（例: `docs/design/`）
2. v1.0 のディレクトリ構成（§8）に沿って `scanner/ worker/ pages/` を作成
3. 実装は **Phase 1（基盤）** から:
   - `worker/schema.sql` を v1.0 §5 の統合DDLで確定
   - `/ingest`（差分＋証跡）→ `orchestrator`（組織ツリー走査）→ `scan-active.yml`
4. 以降 P2→P6（v1.0 §10 ロードマップ）

## 設計原則（実装中も逸脱しないこと）

- **証跡主義**: 証跡なき評価を出さない（evidence_bundle必須、confidence未達は不採用）
- **能動検証**: 推測でなく裏取り（active resolve/probe、帰属検証）
- **タイムリー**: イベント駆動で影響資産のみ即時再評価
- **気の利き**: crown-jewel加重・多因子相関・脅威駆動
- **非破壊/認可**: 第三者に能動スキャンしない。T2/T3はRoE＋変更番号＋保守窓のみ

---

*引き渡しセット — v0.1〜v0.7 ＋ 統合v1.0*
