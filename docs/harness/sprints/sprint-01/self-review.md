# Sprint 01 自己評価（ラウンド 1）

## 実装内容

### 土台
- Next.js 16.3（App Router、Turbopack）、TypeScript strict、shadcn/ui（radix）＋ Tailwind v4、pnpm
- Supabase CLI を devDependency として導入（`supabase/config.toml`、`supabase/migrations/20260924000000_auth_allowlist_and_stocks.sql`）
- テスト: Vitest（`src/**/*.test.ts`、46 件）、Playwright（`e2e/auth.spec.ts`、28 件）
- 運用スクリプト:
  - `scripts/env-local.mjs`（`pnpm env:local`）
  - `scripts/seed-users.ts`（`pnpm seed:users`）
  - `scripts/add-user.ts`（`pnpm auth:add-user`）
- ドキュメント: `CLAUDE.md` にコマンドとアーキテクチャを追記。`README.md`、`.env.example` を追加

### 認証とアクセス制御（多層）
1. **Supabase Auth**
   - `[auth] enable_signup = false` と `enable_anonymous_sign_ins = false` で、新規登録と匿名サインインを止めた。
   - Custom Access Token Hook `private.custom_access_token_hook` が、許可リスト `private.allowed_emails` にないユーザーへのトークン発行を 403 で拒否する。メールが null のユーザーと匿名ユーザーも拒否する。フックはトークン更新時にも実行される。
2. **`src/proxy.ts`**（Next 16 で middleware から改名されたもの）
   - セッションの更新と、楽観的なチェックを行う。未ログインの場合、画面は `/login?next=` に、`/api/*` は 401 にする。
   - matcher は `_next/static/`、`_next/image`、`favicon.ico` だけを明示的に除外している。拡張子による除外はしていない。
3. **保護画面**: `src/app/(app)/layout.tsx` から `requireAllowedUser()` を呼ぶ。
   - 毎リクエスト、`getUser` と `current_user_is_allowed()` で検証する。
   - 許可が取り消されていたら `/auth/signout?reason=revoked` にリダイレクトする。この Route Handler が `signOut` と Cookie の削除を行い、`/login?reason=revoked` に 303 で送る。
   - `/login?reason=revoked` は常にフォームを表示し、どこにもリダイレクトしない。これでリダイレクトのループを防ぐ。
4. **API**
   - `GET /api/stocks` は、ユーザー自身のセッションで RLS を通して読む。
   - `/api/[...path]` は存在しないパスの受け皿。未ログインには、パスの存在を漏らさず 401 を返す。
   - どちらも先頭で `requireApiUser()` を呼び、401／403 を返す。
5. **DB**
   - `public.stocks` は RLS を有効にし、anon の権限をすべて剥奪した。`authenticated` のうち、許可リストに入っているユーザーだけが select できる。
   - 関数の実行権限は `PUBLIC`・`anon`・`authenticated` から剥奪した。`is_email_allowed` と `admin_*` を実行できるのは service_role だけ。
6. **ログイン処理**（`src/lib/auth/login.ts`。依存を注入してテストできる形にした）
   - メールアドレスを正規化し、パスワード照合の前に許可リストを確認する。
   - Auth のエラーを日本語のメッセージに変換する。対象はパスワード誤り、許可リスト外、429、接続不可、想定外のエラー。
7. **`next` の検証**: `sanitizeNextPath` で行う。制御文字、`\`、2文字目の `/` を拒否し、`new URL` でパースして origin が変わらないことを確かめる。
8. **ログアウト**
   - POST `/auth/signout` の後、`window.location.replace('/login')` でフルリロードする。
   - あわせて、ハイドレーション前に実行されるスクリプト `src/lib/http/history-cache-guard.ts` を入れた。戻る／進むで HTTP キャッシュや bfcache から画面が表示されたら、画面を隠して再読み込みする。
   - このスクリプトが要る理由: Next 16 の開発サーバーは画面の応答に `no-cache, must-revalidate` を強制する（`next/dist/server/base-server.js` にコメント付きで実装されている）。そのため `no-store` だけでは、戻る操作でログアウト前の画面が表示された。

### 画面
- **ログイン画面**
  - 製品説明と4条件の概要（静的な説明文で、データではない）、ログインフォーム、エラー表示、送信中の無効化がある。
  - 新規登録の導線はない。
- **ダッシュボード（最小限）**: 見出しと、アカウントの情報を表示する。アカウント情報は、メールアドレス、許可リストへの登録状態、最終ログイン日時（JST、YYYY-MM-DD HH:mm）で、どれも実データ。
- **404 画面**: アプリのレイアウト内に表示する。
- **ヘッダー**: ブランドとアカウントメニュー（メールアドレス、ログアウト）。
- **フッター**: データ出典と注記。全画面に表示する。
- **配色**: `light-dark()` トークンで1か所に定義した。OS の設定に従い、`data-theme` で固定することもできる（手動切り替えは Sprint 2 で実装する）。

## 起動方法

```bash
open -a Docker   # Docker が止まっている場合
pnpm install && pnpm db:start && pnpm db:reset && pnpm env:local && pnpm seed:users && pnpm dev
# http://localhost:3000   owner@quantis.local / Quantis-Owner-2026!
```

## 完了条件チェック

| 条件 | 状態 | 確認方法 |
|---|---|---|
| C1-1〜3 未ログインのリダイレクト | ✅ | E2E（`/`、`/screening`、`/stocks/72030`、`/imports`、`/settings`、`/foo/bar`、`/stocks/72030.png`）。`curl -sI /screening` の結果は 307 と `location: /login?next=%2Fscreening` |
| C1-4 x-middleware-subrequest | ✅ | curl で 4 通りのヘッダー値（middleware/src/middleware/proxy/src/proxy）を試し、すべて 307 で `/login` に送られた |
| C1-5 拡張子付きパス | ✅ | curl で `/stocks/72030.png` は `/login?next=...` へリダイレクト、`/api/stocks.json` は 401 |
| C1-6 保護の二重化 | ✅ | Vitest `src/app/api/stocks/route.test.ts`（セッション無しは 401、許可リスト外は 403、Auth 例外は 401）。保護画面は layout のガードで担保 |
| C2-1〜3 ログイン、リロード、状態保持 | ✅ | E2E。スクリーンショットも確認 |
| C2-4 next と、不正な値 8 ケース | ✅ | E2E で 8 ケースすべて、遷移先のオリジンが localhost:3000 でパスが `/` であることを確認。Vitest でも確認 |
| C2-5 大文字小文字と空白 | ✅ | E2E で `  OWNER@Quantis.Local ` を使用 |
| C2-6 ログイン済みで /login を開く | ✅ | E2E |
| C2-7 コンソールエラーが出ない | ✅ | E2E で console error が 0 件。スクリーンショット取得時も error なし |
| C3-1〜4 パスワード誤り、入力エラー、二重送信 | ✅ | E2E。送信中は `disabled` と「確認しています…」の表示（`useActionState` の pending でボタンを無効化している。E2E では送信中の状態を直接はアサートしておらず、コードで確認した） |
| C3-5 Auth 停止 | ✅ | Playwright スクリプトでログイン画面を開いたまま `pnpm db:stop` を実行してからログインを押した。「認証サーバーに接続できません…」が表示され、pageerror と console error は 0 件。続けて `/` を開くと `/login` に、`/api/stocks` は 401 になった。`db:start` 後もユーザーは残っていた |
| C3-6 429 | ✅ | Vitest（`login.test.ts`）。`config.toml` の `sign_in_sign_ups = 300` |
| C4-1 新規登録の導線が無い | ✅ | E2E。`/signup` は `/login?next=%2Fsignup` にリダイレクト |
| C4-2・3 許可リスト外（アカウントの有無） | ✅ | E2E |
| C4-4 Auth API の直接呼び出し | ✅ | curl の結果: signup は 422 `signup_disabled`。intruder の password grant は 403、`access_token` 無し |
| C4-5 匿名サインイン | ✅ | 422 `anonymous_provider_disabled`。`is_anonymous` の行は 0 件 |
| C4-6 OTP | ✅ | 422 `signup_disabled`。`auth.users` に stranger は作られなかった |
| C4-7 DB | ✅ | psql で確認 |
| C5-1〜4 ログアウト、戻る 2 回、Cookie | ✅ | E2E（ソフトナビゲーションの後にログアウトし、戻るを 2 回押す。Cookie の消去と API の 401 も確認） |
| C6-1〜5 API の 401 | ✅ | curl で、ヘッダー無し、公開キー付き、でたらめな Cookie、`/api/foo` を試し、すべて `{"error":"unauthorized"}` 401 |
| C6-6 許可ユーザーは 200 | ✅ | E2E と curl で、99990 と 99991 の行が返ることを確認 |
| C6-7 許可の取り消し | ✅ | E2E（API は 403、画面は `/login?reason=revoked` とメッセージ、Cookie は消える）。curl で `-sIL --max-redirs 5` を `/` からと `/login` から実行し、どちらもループせずに 200 で止まった |
| C7-1〜5 公開キー、REST、GraphQL、DB | ✅ | curl の結果: stocks は 42501、`allowed_emails` は PGRST205、`Accept-Profile: private` は PGRST106、RPC は 3 関数とも 42501、GraphQL は `pg_graphql extension is not enabled`（行を返さない）。psql で RLS が `t`、ポリシーは authenticated のみ、`has_function_privilege` はすべて `f` |
| C8 フッター | ✅ | E2E でログイン画面、ダッシュボード、404 を確認。375px 幅でも横スクロールしない |
| C9-1 build、lint、typecheck、test | ✅ | すべて成功 |
| C9-2 E2E | ✅ | 28 件すべて成功。dev サーバーでも `pnpm build && pnpm start` の本番サーバーでも通った |
| C9-3 単体テスト | ✅ | `next-path`、`login`、`route`、`format` |
| C9-4 シークレットキーの漏えい | ✅ | `grep -rl "$SUPABASE_SECRET_KEY" .next/static` は 0 件（`service_role` の文字列も 0 件） |
| C9-5 375px・1280px、ダーク | ✅ | Playwright のスクリーンショット（ライトとダーク × 2 幅）で目視確認。E2E に背景輝度のアサーションを入れた |
| C9-6 ダミーデータ無し、E2E の後片付け | ✅ | `db:reset` 直後の stocks は 0 件。E2E の後も 0 件で、許可リストも元に戻る |
| C9-7 .env | ✅ | `.gitignore` の `.env*` に `!.env.example` を追加 |
| C9-8 CLAUDE.md | ✅ | 追記済み |
| C9-9 コミット | ✅ | `sprint-01: 認証とアクセス制御` |
| C10-1〜7 運用コマンド | ✅ | 実行して確認した。新規作成、冪等性（重複行なし・パスワードは変更しない）、`--reset-password`、intruder を追加するとログインでき削除すると拒否されること、引数の欠落・不正なメール・短いパスワードで終了コード 2、ローカル以外の URL で終了コード 1（接続前に判定）、seed を 2 回実行しても 1 件ずつ |

## 既知の問題・未実装
- **GraphQL（C7-4）**: ローカルでは `pg_graphql` 拡張が有効でないため、「extension is not enabled」のエラーになる。行が返らないので条件は満たす。ただし、拡張が有効な環境で `stocksCollection` がエラーになることは確かめていない。anon は `stocks` に対する権限を持たないため、スキーマにも現れないはず。
- **開発サーバーでの戻る操作**: キャッシュから復元されたページは、ハイドレーション前のスクリプトで隠してから再読み込みする。そのため、ログアウト後に「戻る」を押すと、一瞬白い画面になってからログイン画面に移る。内容は表示されない。本番サーバー（`pnpm start`）では、応答が `no-store` なので、このスクリプトが動かなくても再取得される。
- **E2E の前提**: E2E は `pnpm seed:users` 済みであることを前提にしている。また、許可リストを一時的に変更する（テスト終了時に元に戻す）ため、並列実行はしない（`workers: 1`）。
- **ダッシュボード**: 見出しとアカウント情報だけ。件数や鮮度は Sprint 2 で作る。
- **Vercel への本番デプロイ**: 実施していない（契約の対象外）。Supabase のホスト環境で必要な設定は README に書いた。
- **仕様との差異**: 無し。契約の改訂2で、実測に基づいて次を修正した。
  - `[auth.email] enable_signup` を `false` にすると、メールでのログインそのものが無効になるため、`true` のままにした。
  - 環境変数名を、Supabase CLI 2.x の新形式キーに合わせた。

## エバリュエーターに重点的に見てほしい点
- **C6-7 と 4-b（許可の取り消し）**: ログイン中に許可リストから行を削除した直後の API（403）、画面（`/login?reason=revoked`）、Cookie の消去、curl でループしないこと。
- **C5-2（ログアウト後の「戻る」）**: `pnpm dev` と `pnpm start` の両方で確認してほしい。開発サーバーのキャッシュの挙動への対策が効いているかを見てほしい。
- **C3-5（`pnpm db:stop` 中のログイン）**: 日本語のメッセージが出て、Next.js のエラー画面にならないこと。
- **C4-4（Auth API の直接呼び出し）**: フックによる 403 と、`access_token` を含まないこと。
