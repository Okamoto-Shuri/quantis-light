# Sprint 11 自己評価（ラウンド 1）

## 実装内容

F10（条件④の判定の手動補正）。契約は改訂1（R1・R2・推奨事項の反映と、ユーザーの決定「3択」「メモは必須」）。再レビューの実装時の注意3点も守った（下の「再レビューの注意への対応」）。

### DB（マイグレーション `supabase/migrations/20261004000000_ownership_overrides.sql`）

- **`public.ownership_overrides`**（新規。主キー (user_id, code)。`auth.users`・`stocks` への参照は削除で連鎖）
  - 補正時の自動判定の記録の列: `auto_status`・`auto_undeterminable_reason`・`auto_president_is_top_holder`・`auto_owner_total_pct`・`auto_shareholders_doc_id`・`auto_officers_doc_id`
  - check 制約: `verdict in ('president_top','owner_company','not_matched')`、メモ（`char_length` 1〜1,000、前後が空白でない。空白は明示した文字クラス）
  - RLS: select・insert・update・delete の4つのポリシー。すべて `user_id = (select auth.uid()) and (select public.current_user_is_allowed())`
  - authenticated には select・insert・update・delete だけを grant（TRUNCATE・REFERENCES・TRIGGER なし）。anon は権限なし
- **BEFORE INSERT OR UPDATE の行トリガー `ownership_overrides_before_write`**（security invoker）
  - 記録（`auto_*`）を常に `ownership_judgments` から求め直す。行が無ければ「有報が未取得」
  - insert の `user_id` は NULL のときだけ `auth.uid()`
  - `created_at` は insert で now()、update では元の値。`updated_at` は now()
  - `user_id`・`code` の変更は 42501 で拒否。メモの前後の空白を除く
- **判定の式の関数**（set search_path を付けない SQL 関数。展開されるように）
  - `owner_result_of(status, is_top, total, mode, threshold)`（Sprint 10 の `screening_evaluate` の中の式を切り出した）
  - `owner_status_of(result, mode)`
- **`screening_evaluate` の置き換え**: 呼び出したユーザーの補正を結合する。返す列を `owner_auto_result`・`owner_override`・`owner_result`（補正後）・`s_owner`（補正後の状態）にした
- **`ownership_summary(code, result, auto_result, params)`**（引数を変えて作り直した）と **`owner_override_summary(code, params)`**
  - `auto_changed` は、記録と現在の判定の6項目を行の `is distinct from` で比べる
  - `auto_at_override.result` は、記録の値に現在のモード・閾値を当てたもの
  - `auto_current` も返す（知らせの表に使う）
- **`screen_stocks`・`stock_detail` の置き換え**: `auto_result`・`override`・`ownerAutoResult`・`ownerOverride` を加えた。含める規則は変えず、補正後の `s_owner` を使う
- **書き込みの関数**（security invoker）: `owner_override_save`・`owner_override_acknowledge`・`owner_override_delete`
- **姓の読みの辞書**に m3 の読みを追加し（岩崎イワザキ・宮崎ミヤサキ・中沢ナカサワ・小島オジマ／コシマ・塩谷シオタニ／エンヤ。清野キヨノは既にあった）、全銘柄の判定を再計算した

### アプリ

- **`src/lib/ownership/memo.ts`**: メモの規則（空白の文字クラス＝JS の `\s`、前後の除去、コードポイントでの数え方、文言）
- **`src/lib/ownership/override.ts`**: PUT の本文の検証と、応答の日時を日本時間の ISO にする処理
- **`src/lib/ownership/display.ts`**
  - `OWNER_VERDICTS`・`ownerOverrideSchema`・`autoSnapshotSchema` を追加し、要約の形に `auto_result`・`override` を加えた
  - 文言 `OVERRIDE_PRESIDENT_MODE_NOTE`・`OVERRIDE_FILTER_NOTE`、関数 `formatJstDateTime` を追加した
- **API**
  - `src/app/api/stocks/[code]/ownership-override/route.ts`（GET・PUT・DELETE）と `…/acknowledge/route.ts`（POST）
  - 認証は `requireApiUser()`、書き込みは同一オリジンの確認、応答は `jsonNoStore`。書き込みはユーザーのセッションで DB 関数を呼ぶ
  - 既存の `GET /api/stocks/[code]`・`GET /api/screening` は、override の日時を日本時間にするよう変えた
- **画面**
  - `src/components/stocks/owner-override.tsx`（新規。補正の区画。状態は none・editing・saved）
    - 選択肢は3つのラジオ。メモは textarea で、maxLength は付けない。文字数は「N / 1,000」
    - 保存・編集・取り消し（確認のダイアログ）・確認済みにする。自動判定の更新の知らせは、補正時と現在の表で、変わった項目を強調する
    - 書き込みの後の `router.refresh()` は、状態の切り替えと同じ遷移の中で行う
  - `src/components/ui/alert-dialog.tsx`（新規。Radix の AlertDialog）
  - `src/components/stocks/ownership-sections.tsx`
    - 判定根拠の先頭に補正の区画を置いた
    - `data-result` は自動判定、`data-effective-result` は補正後。補正があれば「手動補正」のラベルと「自動判定: …」を並べる
    - m5: 判定不能では書類の見出しを「対象の有報（判定には使っていません）」にした
    - m1: 375px では順位と分類理由を氏名のセルに出し、氏名のセルの最小幅を 120px にした
  - `src/components/stocks/stock-evaluation.tsx`: 条件④の行に、補正のラベル・補正後の判定・「自動判定: …」と、モードの注記を出す
  - `src/components/screening/owner-cells.tsx`: 補正のラベル・補正後の判定・「自動: …」を出す。ポップオーバーの先頭に補正の欄（メモの先頭 120 文字・更新日・自動判定の更新の知らせ）を置いた
  - `results-table.tsx`（`data-result`・`data-auto-result`・`data-override`、④の印の title の「（手動補正）」）、`status-mark.tsx`（`suffix`）、`condition-panel.tsx`（注記の1文）
  - `src/components/ownership/ownership-bar.tsx`
    - `ManualOverrideLabel` を追加した（紫の `manual` トークンと鉛筆のアイコン）
    - m6: 区分名は `CategoryName` の1つにそろえた。文字列は「資産管理会社（推定）」で、「（推定）」の部分を推定のラベルとして描く
  - `src/app/globals.css`: `manual`・`manual-muted`・`manual-strong` のトークン（ライト・ダーク）
- **`scripts/seed-users.ts`**: owner2@quantis.local（許可）を追加した
- **`CLAUDE.md`**: 「現状」を Sprint 11 にし、手動補正の節を追加した。あわせて評価用ユーザー、テストの接頭辞、dev サーバーのメモリの再起動、Sprint 12 で `stocks` を消さないこと、辞書の追加の方針を書いた

### テスト

- **`src/lib/ownership/ownership-override.db.test.ts`**（18件）
  - 補正3種×モード2種×自動判定4種×閾値3種とオフ、owner2 と service_role への影響なし
  - スクリーニングの件数（第5章）、`sort=owner` で最後
  - `stock_detail`
  - `auto_changed`（訂正有報・消す・再投入・確認済み・編集、同じ内容の再計算、取り込み待ち、有報未取得→取り込み、取り下げ）
  - 補正時の結果の名前の式
  - RLS（owner2・intruder・anon）、直接の書き込みの6項目
  - 空白の文字集合と JS の `\s` の一致（U+0001〜U+FFFF を DB と JS の両方で）
  - 連鎖の削除、関数の NULL・false、辞書の追加、性能
- **`src/lib/ownership/memo.test.ts`**（4件）と **`src/app/api/stocks/[code]/ownership-override/route.test.ts`**（5件）
- **`e2e/ownership-override.spec.ts`**（14件）: 契約の C10-4 に挙げた完了条件のすべて
- **`e2e/db-privileges.spec.ts`**: 補正の権限・ポリシーの形・トリガー関数の権限、公開キーでの REST（2件を追加）
- 投入例: `e2e/fixtures/ownership-override-add.sql`（SYTEST16）・`ownership-override-add-9u004.sql`（SYTEST04）・`ownership-override-cleanup.sql`

## 起動方法

```bash
pnpm install && pnpm db:start && pnpm db:reset && pnpm env:local && pnpm seed:users
JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm dev -p 3100
# 本番相当: pnpm build && JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm start -p 3100
```

- 投入例: `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f e2e/fixtures/ownership-example.sql`
- 画面: http://localhost:3100/stocks/9U003 （補正の操作）、http://localhost:3100/screening
- ユーザー
  - `owner@quantis.local` / `Quantis-Owner-2026!`
  - `owner2@quantis.local` / `Quantis-Owner2-2026!`
  - `intruder@quantis.local` / `Quantis-Intruder-2026!`（許可リスト外）

## 完了条件チェック

「E2E」は `e2e/ownership-override.spec.ts` で、実際のブラウザ（dev、3100 番）で確かめた。「DB」は `ownership-override.db.test.ts` による。

| 条件 | 状態 | 確認方法 |
|---|---|---|
| C1-1〜C1-3 補正の区画・キャンセル・検証 | ✅ | E2E で確かめた（全角空白だけ・改行だけ・混在・1,001・「𠮷」1,001 は拒否、「𠮷」1,000 は「1,000 / 1,000」で保存、1,000＋末尾の改行は 1,000 で保存）。どの拒否でも DB は0行 |
| C1-4 保存（改行のメモ・日時・記録の列） | ✅ | E2E。psql 相当の SQL で `auto_*` が determined・false・0・SXTEST03 であることも確かめた |
| C1-5 XSS | ✅ | E2E（`<script>` と `onerror` の文字列がそのまま表示され、dialog は0件） |
| C1-6 編集（updated_at だけが新しくなる） | ✅ | E2E |
| C1-7 小文字のコード | ✅ | E2E（`9u002` → 9U002 の行）、単体テスト |
| C2-1 詳細の表示 | ✅ | E2E（`data-result` は not_matched、`data-effective-result` は owner_company、手動補正のラベル、「自動判定: 非該当」、含まれる、内訳 0.0%） |
| C2-2 一覧の表示 | ✅ | E2E（8件、セルの属性、ラベル、「自動: 非該当」、ポップオーバー（ホバー・クリック・Enter）、印の title の「（手動補正）」、補正の無い行にはラベルが無い） |
| C2-3〜C2-5 モード・閾値・オフ | ✅ | E2E（5件、unmet とモードの注記、`owner=40` で6件、オフ） |
| C2-6 3つの補正 | ✅ | E2E・DB（8件、除外2件、include で10件、9U004 は met） |
| C2-7 API | ✅ | E2E・DB |
| C2-8 幅 | ✅ | E2E（1280 で表が横スクロールしない。375 でページ幅 375、補正の区画・フォーム・ポップオーバーが画面の中） |
| C3-1〜C3-4 取り消し・再読み込み | ✅ | E2E（リロード・再ログインで残る。ダイアログのキャンセルでは変わらず、取り消すと none・「非該当」、7件、2回目の DELETE は `deleted: false`） |
| C3-5 保存・取り消しの直後に戻る | ✅ | E2E。パンくず・ヘッダー・ブラウザの戻る（保存後と取り消し後の2回）で、直後の状態のセルになることを確かめた。条件・並べ替えの URL も保たれる（下の注を参照） |
| C4-1・C4-2 ユーザーごとの分離 | ✅ | E2E（別のコンテキストで owner2 にログイン） |
| C4-3 PostgREST（owner2 の JWT） | ✅ | E2E（Auth の API でトークンを取得して REST を直接呼んだ）・DB |
| C4-4 anon | ✅ | E2E（db-privileges）・DB |
| C4-5 intruder | ✅ | DB（読めず、書けない。保存の関数は銘柄マスタが見えないので NULL で、何も保存しない） |
| C4-6〜C4-8 401・403・400・404 | ✅ | E2E・単体テスト |
| C4-9 許可の取り消し | ✅ | DB の RLS（`current_user_is_allowed()`）で担保。E2E の自動化はしていない（評価者に確かめてほしい） |
| C5-1〜C5-4 自動判定の更新の知らせ | ✅ | E2E・DB（表の値と「変更」の強調、一覧のポップオーバーのヒント、消すと消える、確認済みで SYTEST16・17.00 に置き換わる、その後に消すと再び出る） |
| C5-5 知らせを出さないケース | ✅ | DB（住所だけの update、未処理の新しい有報） |
| C5-6 取り下げで判定不能に変わる | ✅ | E2E・DB |
| C5-7 補正の無い確認済み | ✅ | E2E（404 `override_not_found`） |
| C5-8 編集で記録が置き換わる | ✅ | DB |
| C5-9 有報未取得 → 取り込み → 知らせ | ✅ | E2E・DB |
| C5-10 sort=owner で最後 | ✅ | E2E・DB |
| C6-1〜C6-3 判定の式・RLS・サービスロールを使わない | ✅ | DB。補正のコードは `lib/supabase/admin.ts` を import しない。TypeScript に判定の式は無い（知らせの表の「変わった項目の強調」の比較だけは表示のため TS にある。知らせを出すかどうかは DB の `auto_changed`） |
| C6-4 直接の書き込みの6項目 | ✅ | E2E（REST）・DB |
| C7 性能 | ✅ | DB（4,000 銘柄、2人×1,000 補正）。数値は下の「テストの結果」 |
| C8-1 m1（375px の氏名の列） | ✅ | E2E（氏名のセルは 120px 以上、信託口の名称は4行以下、比率と区分の右端は 375 以内） |
| C8-2 m5 | ✅ | E2E |
| C8-3 m3 | ✅ | DB（読みの追加と、「株式会社イワザキ興産」が資産管理会社（推定）になること） |
| C8-4 m6 | ✅ | E2E（一覧のポップオーバー・詳細の合計・明細で、区分名の textContent が同じ。推定のラベルは区分3・4だけ） |
| C9-1 コントラスト | ✅ | oklch から計算した。「手動補正」のラベル（manual-strong / manual-muted）はライト 7.75・ダーク 9.15。枠線（manual / card）はライト 5.93・ダーク 7.92。知らせは既存の caution のトークン |
| C9-2 時計のずれ | ✅ | E2E（保存・知らせ・取り消しでコンソールのエラー0件） |
| C9-3 キーボード | ✅ | E2E（Enter で開く → 選択肢にフォーカス → 矢印・Space → Tab でメモ → 保存 → ダイアログはフォーカスを閉じ込め、Esc で閉じてトリガーに戻る → 取り消す） |
| C9-4 ingestion_runs が変わらない | ✅ | 補正の経路は取り込みを呼ばない（コード上）。E2E の前後で実行履歴は0件 |
| C9-5 コンソールのエラー | ✅ | E2E の `collectPageProblems`（C1・C9-2）。本番ビルドでも E2E で確かめた（下のテストの結果） |
| C10-1 既存テストの変更の範囲 | ✅ | 下の「既存テストの変更」 |
| C10-2〜C10-5 | ✅ | 下の「テストの結果」 |
| C10-6 seed:users | ✅ | owner2 を追加した（ローカル限定の確認はそのまま） |
| C10-7〜C10-9 コミット・CLAUDE.md・self-review | ✅ | |

注（C3-5）: 補正を保存・取り消した銘柄を常に一覧に出すため、E2E では条件④をオフ（`off=owner`）にして、9U002 の条件④のセル（補正後の判定と「手動補正」）で「直前の操作が反映されたか」を見た。

## テストの結果

（最後に実行した結果）

| コマンド | 結果 |
|---|---|
| `pnpm lint` | 成功 |
| `pnpm typecheck` | 成功 |
| `pnpm test` | 503 件成功 |
| `pnpm test:db` | 197 件成功（13 ファイル） |
| `pnpm build` | 成功 |
| `E2E_PORT=3100 pnpm test:e2e`（dev・キーなし・空の DB） | 237 件。全件の実行を2回行った。1回目は 236 件成功・1件失敗（`shell.spec.ts` の 375px のドロワー。30 秒のタイムアウト）。2回目は 228 件成功・1件失敗（`stock-detail.spec.ts` C6 の `ERR_CONNECTION_REFUSED`）で、同じ serial の describe の残り8件が走らなかった。**どちらの失敗も、その時刻に dev サーバーがメモリの閾値で自動的に再起動していた**（dev のログに `approaching the used memory threshold, restarting`。Sprint 10 評価の環境の注記と同じ）。失敗したファイルを単独で流すと、`shell.spec.ts` 19 件・`stock-detail.spec.ts` 23 件がすべて成功した。Sprint 11 の `ownership-override.spec.ts`（14件）と `db-privileges.spec.ts`（22件）は、どちらの回でも成功した |
| 本番相当（`pnpm build && pnpm start -p 3100`） | `ownership-override.spec.ts` と `ownership.spec.ts` の 31 件が成功（時計のずれの C9-2 を含む。コンソールのエラー0件） |

- 性能（`ownership-override.db.test.ts`）: 4,000 銘柄・2人×1,000 補正で、`screen_stocks`（既定・オーナー系合計の順）は 100ms 以内、`stock_detail` は 20ms 以内の検査に通った（テストの中の console.log は vitest の設定で表示されないため、数値は記録していない）
- E2E の後、DB の市場データ・EDINET・判定・補正・実行履歴は0件に戻る。

## 再レビューの注意への対応

1. **insert の `user_id`**: トリガーは `user_id` が NULL のときだけ `auth.uid()` を入れ、値が渡されたらそのまま残す。owner2 が owner の id を指定した insert は、RLS の with check で拒否される（42501。E2E の C4-3 と DB）。`user_id` を省いた insert は自分の id で保存される（C6-4 の6）。
2. **トリガー関数の EXECUTE**: authenticated からは revoke した。それでもトリガーは発火し、E2E と DB のすべての書き込みで記録が求め直されている。検査は「authenticated が関数を直接実行できない」ことだけを見る（`has_function_privilege` が false）。
3. **textarea の maxLength**: 付けていない（コメントも残した）。「𠮷」1,000 個を画面から保存でき、1,001 個は文言で拒否される（E2E）。

## 既存テストの変更（C10-1）

| ファイル | 変更 | 種類 |
|---|---|---|
| `src/app/api/stocks/[code]/route.test.ts` | モックの応答 `DETAIL` の `evaluation` に `ownerAutoResult: "president_top", ownerOverride: null`、`ownership` に `auto_result: "president_top", override: null` を加えた（応答の形のスキーマが必須にしたため）。`expect(body.data.evaluation).toEqual({...})` の厳密な比較に `ownerAutoResult: "president_top"`・`ownerOverride: null` を加えた | 1（新しい項目） |
| `e2e/db-privileges.spec.ts` | 「authenticated は public のテーブルに書き込めない」: 期待値 `[]` → `ownership_overrides` の DELETE・INSERT・UPDATE の3行。見る権限に REFERENCES・TRIGGER を加えた（厳しくした）。テストの名前に例外を書いた | 2（権限の許可リスト） |
| `e2e/db-privileges.spec.ts` | authenticated が実行できる関数の一覧に `owner_override_acknowledge`・`owner_override_delete`・`owner_override_save`・`owner_override_summary`・`owner_result_of`・`owner_status_of` を加えた | 2 |
| `e2e/db-privileges.spec.ts` | 条件④の service_role だけの関数の一覧に `ownership_overrides_before_write` を加えた | 2 |
| `e2e/db-privileges.spec.ts` | authenticated が参照できるテーブルの一覧に `ownership_overrides` を加えた | 2 |

- 種類3（m6 の区分名）の期待値の変更は不要だった。既存の E2E の確認は「資産管理会社」を含むか（`toContainText`）と `estimated-label` の有無なので、新しい表記（textContent「資産管理会社（推定）」）でもそのまま通る。
- DOM の変更で、既存のアサーションは変えていない。
  - 詳細の明細の `breakdown-name` の testid を、セルの中の氏名の span に移した（セルには `breakdown-name-cell`）。既存の `toHaveText(name)` はそのまま通る。
  - 一覧の条件④のセルの中に、下線の span を足した。
- 想定外の変更: なし。

## 既知の問題・未実装

- 補正の履歴は持たない（最新の1つだけ）。複数のタブで同時に編集すると後の書き込みが勝つ（契約の第8章）。
- C4-9（許可の取り消し）は E2E で自動化していない。
  - `private.allowed_emails` から owner2 を消すと、`requireApiUser()` が 403 を返す。RLS の `current_user_is_allowed()` も false になり、読めず書けない（DB テストの intruder と同じ経路）。
- 知らせの表の「変わった項目の強調」は、表示のために TypeScript で項目を比べている。知らせを出すかどうか（`auto_changed`）は DB だけが決める。
  - オーナー系合計の比較は数として比べるので、DB の `is distinct from`（numeric）と同じ結果になる。
- 「確認済みにする」は、DB では `verdict = verdict` の update でトリガーに記録を求め直させている。そのため `updated_at` も新しくなる（補正日時の表示に「更新」が出る）。
- 3000 番のポートには触れていない（すべて 3100 番）。

## エバリュエーターに重点的に見てほしい点

- 直接の書き込み（PostgREST）で、記録・日時・user_id・code を偽れないこと（C4-3・C6-4）。
- 補正の保存・取り消しの直後に、ブラウザの「戻る」でスクリーニングに戻ったとき、古い結果が出ないこと（C3-5）。
- 「社長が筆頭株主のみ」モードで「該当（オーナー企業）」の補正が満たさないこと、閾値を変えても補正の結果が変わらないこと（ユーザーの決定の3択）。
- 375px の詳細（補正の区画・知らせの表・内訳の明細の氏名の列）の見た目。
