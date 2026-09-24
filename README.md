# Quantis Light

個人用の日本株スクリーナー（Next.js + Supabase）。仕様は `docs/harness/spec.md`。

## ローカルでの起動

前提: Node.js 22、pnpm、Docker（Docker Desktop を起動しておく）

```bash
pnpm install
pnpm db:start      # ローカル Supabase（初回はイメージ取得に数分）
pnpm db:reset      # マイグレーション適用
pnpm env:local     # .env.local を生成
pnpm seed:users    # 評価用ユーザー（ローカル専用）
pnpm dev           # http://localhost:3000
```

## ユーザーの追加（本番・ローカル共通）

新規登録画面はありません。許可リストへの追加とユーザー作成は次のコマンドで行います。

```bash
pnpm auth:add-user --email you@example.com --password 'your-password'
```

## Vercel へのデプロイ

環境変数 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_SECRET_KEY` を設定します。
Supabase のホスト環境では、次を設定してください（ローカルでは `supabase/config.toml` で設定済み）。

- Authentication → Sign In / Providers: 「Allow new users to sign up」を無効、匿名サインインを無効
- Authentication → Hooks: Custom Access Token Hook に `private.custom_access_token_hook` を指定
- マイグレーションは `pnpm supabase db push` で適用
