# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## 現状

Quantis Light（個人用の日本株スクリーナー。仕様は `docs/harness/spec.md`）を、ハーネスでスプリントごとに構築中。Sprint 1（認証とアクセス制御）まで実装済み。

## 技術スタック

- TypeScript（strict）、Next.js 16（App Router、Turbopack）、React 19
- shadcn/ui（radix ベース）＋ Tailwind CSS v4、lucide-react
- Supabase（Auth ＋ Postgres）。Next.js 連携は `@supabase/ssr`（Cookie セッション）
- Vitest（単体テスト）、Playwright（E2E）
- pnpm。Supabase CLI は devDependency（`pnpm supabase ...`）。Docker が必要

Next.js 16 は学習データと異なる点が多い（middleware は `src/proxy.ts` に改名など）。実装前に `node_modules/next/dist/docs/` を確認すること。

## コマンド

| コマンド | 内容 |
|---|---|
| `pnpm db:start` / `pnpm db:stop` | ローカル Supabase の起動／停止（API 54321、DB 54322、Studio 54323、Mailpit 54324） |
| `pnpm db:reset` | DB を作り直してマイグレーションを適用（ユーザーも消える） |
| `pnpm env:local` | `supabase status` から `.env.local` を生成 |
| `pnpm seed:users` | ローカル専用。評価用ユーザー（owner＝許可、intruder＝許可リスト外）を作成（冪等） |
| `pnpm auth:add-user --email <e> --password <p> [--reset-password]` | 許可リストへの追加とユーザー作成 |
| `pnpm dev` / `pnpm build` / `pnpm start` | http://localhost:3000 |
| `pnpm lint` / `pnpm typecheck` | ESLint / `tsc --noEmit` |
| `pnpm test` | Vitest（`src/**/*.test.ts`）。1ファイルだけ: `pnpm test src/lib/auth/next-path.test.ts` |
| `pnpm test:e2e` | Playwright（`e2e/`）。ローカル Supabase 起動・`seed:users` 済みが前提。dev サーバーは未起動なら自動起動 |

初回セットアップ: `pnpm install && pnpm db:start && pnpm db:reset && pnpm env:local && pnpm seed:users && pnpm dev`

## アーキテクチャ

- **ディレクトリ**: `src/app`（ルート）、`src/lib`（ロジック。`auth/`、`supabase/`、`http/`）、`src/components`（`ui/` は shadcn 生成物）、`supabase/migrations`（DB スキーマの正本）、`scripts/`（運用コマンド）、`e2e/`
- **認証・アクセス制御（多層）**
  1. Supabase Auth: `config.toml` で新規登録・匿名サインインを無効化。Custom Access Token Hook（`private.custom_access_token_hook`）が許可リスト（`private.allowed_emails`）外へのトークン発行を拒否
  2. `src/proxy.ts`: セッション更新と楽観的チェック（未ログインの画面は `/login?next=`、`/api/*` は 401）
  3. 保護画面: `src/app/(app)/layout.tsx` → `requireAllowedUser()`（`lib/auth/guard.ts`）が毎リクエスト `getUser` ＋ `current_user_is_allowed()` で検証。許可取り消し・無効な Cookie は `/auth/signout`（Cookie を消せる Route Handler。GET は状態を判定してから破棄）へ、Auth 障害時はセッションを残して `/login` へ
  - ログアウト（`POST /auth/signout`、同一オリジンのみ）とセッション破棄の応答は `Clear-Site-Data: "cache"` を返す。`next dev` は画面を `no-cache` で返すため、これが無いと「戻る」で保護画面がキャッシュから表示される
  4. API: 各 Route Handler の先頭で `requireApiUser()`（`lib/auth/api.ts`）。401／403／503（Auth 障害）
  5. DB: 市場データのテーブルは RLS 有効、anon に権限なし、`authenticated` かつ許可リスト登録済みのみ select。書き込みは service_role のみ。`alter default privileges` で新しいテーブル・関数に anon/authenticated の権限は自動で付かない（必要な権限はテーブル・関数ごとに明示的に grant する）。`e2e/db-privileges.spec.ts` が全テーブル・関数の権限を検査する
  - Auth のメール送信は Send Email Hook（`private.block_auth_email_hook`）ですべて拒否（アプリはメールを使わない）
- **新しい保護画面**は `src/app/(app)/` 配下に置く。**新しい API** は `requireApiUser()` を必ず呼び、`jsonNoStore` で返す。**新しい市場データのテーブル**は `public.stocks` と同じ RLS・権限方針にする
- サービスロール（`SUPABASE_SECRET_KEY`）は `src/lib/supabase/admin.ts`（server-only）からのみ使う。画面のデータ読み出しはユーザーのセッション（RLS 経路）で行う
- 配色は `src/app/globals.css` の `light-dark()` トークンで定義。`<html data-theme="light|dark">` で固定でき、未指定なら OS 設定に従う
- ローカルの環境変数: `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_SECRET_KEY`（`.env.example`）

## 開発ハーネス（planner → generator → evaluator）

起動: `/harness <1〜4行のプロンプト>`（`.claude/skills/harness/SKILL.md`）。メインセッションはオーケストレーターに徹し、自分では実装もテストもしない。

- `planner`（`.claude/agents/planner.md`）: プロンプトを `docs/harness/spec.md` に展開する。「何を作るか」だけを書き、実装の詳細（DB スキーマ、ライブラリ、API 設計）は書かない。受け入れ基準は、ブラウザ操作で合否を判定できる形にする。
- `generator`（`.claude/agents/generator.md`）: 1スプリントで1機能を実装する。モードは契約・実装・修正の3つ。スタブやダミーデータで動いているように見せることは禁止。git リポジトリであれば、スプリントごとに `sprint-NN: <機能名>` でコミットする。
- `evaluator`（`.claude/agents/evaluator.md`）: Playwright MCP（`.mcp.json`）で実際に操作し、画面・API・データベースの3段階で検証する。ソースコードは編集しない（Edit 禁止）。

サブエージェント同士は直接会話できない。受け渡しはすべて次のファイルで行う。

```
docs/harness/spec.md
docs/harness/sprints/sprint-NN/{contract.md, contract-review.md, self-review.md, evaluation-R.md}
```

合否判定: 機能性 ≥8、仕様充足度 ≥7、デザイン ≥6、コード品質 ≥6。1つでも閾値を下回るか、契約の完了条件が1つでも未達、または起動失敗・リグレッションがあれば不合格。同じスプリントで5ラウンド不合格になったら、ループを止めてユーザーに判断を仰ぐ。
