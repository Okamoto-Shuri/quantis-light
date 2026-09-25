# Sprint 13 自己評価（ラウンド 1）

## 実装内容

F12（条件プリセット）。契約（改訂1、承認済み）の第2章のとおり実装した。

- **DB**（`supabase/migrations/20261006000000_screening_presets.sql`）
  - テーブル `public.screening_presets`（id・user_id・name・query・is_default・created_at・updated_at）
    - 一意制約 `screening_presets_user_name_key`
    - 部分一意索引 `screening_presets_one_default_idx`
    - 索引 (user_id, created_at, id)
  - RLS・権限は Sprint 11 の `ownership_overrides` と同じ方針（authenticated は select・insert・update・delete だけ、4つの操作で本人かつ許可ユーザー）
  - check 制約
    - 名前: 1〜40 コードポイント、前後に空白なし、制御文字・U+2028・U+2029 なし
    - query: 全体一致の正規表現で、パラメータごとの文字クラスは契約の表のとおり。長さは 1,000 まで
  - トリガー `screening_presets_before_write`
    - user_id は NULL のときだけ auth.uid()
    - id・user_id の変更は 42501
    - created_at は固定
    - updated_at は名前・クエリが変わったときだけ新しくする
    - 名前の前後の空白を除く
    - ユーザーごとの advisory lock を取ってから数え、50 件を超える insert は QP050
  - 関数（security invoker）: `create_screening_preset`、`update_screening_preset`、`set_default_screening_preset`、`screening_preset_json`
    - どれも「ユーザーごとのロック → 対象の行を for update → 無ければ何も変えずに NULL → 切り替え」の順
- **ロジック**
  - `src/lib/screening/presets.ts`（client・server 共通）: 名前の規則、クエリの正規化と解釈（ok／invalid／noncanonical）、セレクターの優先順位、要約、入力中の無効な値の注記
  - `preset-queries.ts`: 読み出し（server-only、RLS 経路）
  - `preset-api.ts`: API の本文の検証、DB のエラーの分類（23505 は制約の名前で区別）、応答の形
  - `src/lib/text/whitespace.ts`: 空白の文字集合。Sprint 11 のメモから移し、メモとプリセットの名前で共有する
- **API**: `src/app/api/screening/presets/route.ts`（GET・POST）、`[id]/route.ts`（PATCH・DELETE）
- **画面**
  - `src/components/screening/preset-bar.tsx`: セレクター、保存のダイアログ、管理のダイアログ、上書きの確認、削除の確認
  - `src/components/ui/dialog.tsx`: 新規。shadcn の dialog と同じ形
  - `screening-view.tsx` の変更
    - `replaceAll`（適用・既定に戻す）
    - `flushQueued`（`openDetail` と共有）
    - 入力欄のエラーの集計
  - `threshold-field.tsx`・`condition-panel.tsx`: `onInvalidChange`、「既定の条件に戻す」の説明
- **既定のプリセット**
  - `/screening/page.tsx`: 条件のパラメータが無ければ `redirect()`。読み出しに失敗したら標準の条件＋注記
  - `/stocks/[code]/page.tsx`・`lib/stocks/detail.ts`（`detailConditionsWithPreset`・`hasScreeningParams`）・`stock-evaluation.tsx`: 詳細の既定のプリセット（`data-condition-source`）と、読み出しの失敗の注記
- **持ち越し**
  - C8-1: `lib/ingestion/runs.ts` の `isRemainingUnknown`、実行履歴・詳細の「残り 不明」
  - C8-2: CLAUDE.md の E2E の手順
- **テスト**
  - 単体: `presets.test.ts`、`preset-api.test.ts`、`lib/stocks/detail.test.ts` に3件
  - DB: `lib/screening/presets.db.test.ts`（16件）
  - E2E: `e2e/screening-presets.spec.ts`（32件）、`db-privileges.spec.ts` に2件
  - 投入例: `e2e/fixtures/screening-presets-example.sql`・`screening-presets-cleanup.sql`
- **CLAUDE.md**: 「現状」、E2E・test:db の前提と接頭辞、条件プリセットの節、C8-2 を更新した

## 起動方法

```bash
pnpm db:reset && pnpm env:local && pnpm seed:users
JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm dev -p 3100
# 本番相当: pnpm build && JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm start -p 3100
```

- 投入例: `e2e/fixtures/ownership-example.sql` → `e2e/fixtures/screening-presets-example.sql`
- 画面: http://localhost:3100/screening
- 評価後の DB は、市場データ・EDINET・プリセット・実行履歴がすべて0件に戻してある。3100 番のサーバーは止めてある。

## テストの結果

- `pnpm lint`・`pnpm typecheck`・`pnpm build`: 成功
- `pnpm test`: 547/547（52 ファイル）
- `pnpm test:db`: 234/234（16 ファイル）
  - C7 の実測値: プリセットの一覧 0.85ms、既定 0.34ms（中央値。基準は 20ms・10ms）
- E2E（本番相当のサーバー、キーなし、3100 番）: **284/284 成功**
  - 既存 250 件 ＋ 新規 32 件 ＋ db-privileges の2件
  - `screening-presets.spec.ts` だけを続けて3回流し、3回とも 32/32
- E2E（dev、3100 番）: `screening-presets`・`stock-detail`・`shell`・`ingestion-reliability`・`screening` の 105/105 成功（時計のずれの検査を含む）
- test:db と E2E は同時に流していない。

## 完了条件チェック

| 条件 | 状態 | 確認方法 |
|---|---|---|
| C1-1〜C1-2 保存と表示 | ✅ | E2E。DB の query・is_default、状態の文言、URL が変わらないこと |
| C1-3 名前の検証 | ✅ | E2E（空・半角・全角空白、41 文字、「𠮷」41/40 個、重複、前後の空白）＋単体 |
| C1-4 閾値 40・並べ替えの保存 | ✅ | E2E |
| C1-5 待っている書き換えの確定 | ✅ | E2E（入力の直後に保存 → 要約が CAGR ≥25% → query は cagr=25） |
| C1-6 XSS | ✅ | E2E（`dialog` イベント 0 件） |
| C1-7 API（正規形・400・既定つきの作成・重複で既定が変わらない） | ✅ | E2E＋単体 |
| C1-8 上限 50 | ✅ | E2E（ボタンが無効・文言、409 `preset_limit`）＋test:db（同時の insert） |
| C1-9 無効な入力値・既定の置き換えの注記 | ✅ | E2E |
| C2-1〜C2-4・C2-9 適用 | ✅ | E2E（URL・入力欄・`aria-sort`・行の順・セレクター・リロード） |
| C2-5 無効な入力の破棄 | ✅ | E2E |
| C2-6 待っている入力 | ⚠️ | E2E で、最終的な URL が「厳しめ」のクエリで5件になることを確かめた。下の「既知の問題」1を参照 |
| C2-7 一致の表示の変化 | ✅ | E2E |
| C2-8 履歴 | ✅ | E2E（戻る → ダッシュボード、進む → 厳しめ） |
| C2-10 375px | ✅ | E2E（横スクロールなし、注記は画面内、シートでグロースが選択済み） |
| C2-11 無効・正規形でないプリセット | ✅ | E2E（印・注記・適用後の URL・API の invalidFields）＋単体 |
| C2-12 表示の優先順位 | ✅ | E2E＋単体 |
| C3-1 名前の変更 | ✅ | E2E（Enter・重複・空・Esc・updated_at・created_at） |
| C3-2 上書き | ✅ | E2E（違いの強調 `data-changed`、キャンセル、上書き後の query、同じ条件ではボタンが無効） |
| C3-3・C3-4 削除 | ✅ | E2E（alertdialog、キャンセル、URL 不変、既定の削除の注記、削除後に `/screening` が標準） |
| C3-5 API（404・400・409・名前と既定の同時の変更） | ✅ | E2E＋test:db |
| C3-6 キーボード | ✅ | E2E（メニュー・管理・名前の変更・上書き・削除、フォーカスの閉じ込め、戻り先。body に落ちない） |
| C4-1〜C4-3 既定・リダイレクト・再読み込みなしの反映 | ✅ | E2E（ナビゲーション、`goto`、GET の 307 と Location、既定の変更の直後のヘッダーの「スクリーニング」、閾値を変えた後に既定へ戻る） |
| C4-4・C4-5 上書きしない URL・utm | ✅ | E2E（明示的な URL、`page=1`、パンくず・ヘッダー・戻る） |
| C4-6・C4-7 既定に戻す・解除 | ✅ | E2E（`title` の説明、解除後は標準） |
| C4-8・C4-9 詳細と API | ✅ | E2E＋単体 |
| C4-10 既定のプリセットに無効な項目 | ✅ | E2E |
| C4-11 読み出しの失敗 | ✅ | E2E（authenticated の select を revoke。finally と afterAll で `grant select` だけを戻す） |
| C4-12 時計のずれ | ✅ | E2E（dev と prod の両方で成功） |
| C5-1〜C5-3 永続性と分離 | ✅ | E2E（リロード・再ログイン・owner2） |
| C5-4 PostgREST（owner2） | ✅ | E2E（select・update・delete・偽った insert・RPC に owner の id と存在しない id）＋test:db |
| C5-5 直接の書き込み | ✅ | E2E（PostgREST で 1〜7 と、C5-5-5 のすべての拒否と通過）＋test:db |
| C5-6〜C5-9 anon・intruder・未ログイン・別のオリジン | ✅ | E2E＋test:db（intruder） |
| C5-10 許可の取り消し | ✅（DB で確認） | psql のトランザクションの中で owner2 を `private.allowed_emails` から消し、authenticated（owner2 の JWT の sub）として確かめてから rollback した。<br>結果: 自分のプリセットが0行、RPC は NULL、insert は RLS で拒否。<br>API の 403 は共通の `requireApiUser()` による（Sprint 11 の C4-9 と同じ経路）。<br>ブラウザでの手順は流していない |
| C6-1 DB | ✅ | test:db（同時の切り替え・同時の insert は、2つの接続と `pg_stat_activity` で advisory lock の待ちを確かめてから commit。check を通る正規形は 960 件超を定義の正規表現で確かめた。末尾の改行・CRLF は拒否、`cagr=99999` は通る） |
| C6-2 検証の1か所 | ✅ | コード（`presets.ts` は `parseScreeningParams` を呼ぶだけ。SQL は形だけ） |
| C6-3 RLS 経路 | ✅ | コード（`admin.ts` を import していない） |
| C6-4 権限 | ✅ | E2E `db-privileges.spec.ts` |
| C7 性能 | ✅ | test:db（実測値は上） |
| C8-1 残り 不明 | ✅ | E2E |
| C8-2 CLAUDE.md の手順 | ✅ | 記載した。DO ブロックで既定値を置き換えられることを、トランザクションの中で確かめてから rollback した |
| C9-1 コントラスト | ✅（既存のトークン） | 既定のバッジは `signal-strong` on `signal-muted`、無効の印・注記・違いの強調は `caution-strong` on `caution-muted`。どちらも既存の画面で AA を確かめたトークンの組み合わせ。今回は測っていない。違いの強調は色に加えて太字・「●」・読み上げの「変更:」で示す |
| C9-2・C9-3 レイアウト | ✅ | E2E（1280 で市場区分・注記・プリセットが画面内、表は横スクロールなし。375 でダイアログのボタンが画面内、長い名前で横スクロールなし）＋スクリーンショット（ライト・ダーク） |
| C9-4・C9-6 コンソール | ✅ | E2E（`collectPageProblems`） |
| C9-5 実行履歴が変わらない | ✅ | 外部 API を呼ばない。E2E の前後の DB は0件 |
| C10 リグレッション・品質 | ✅ | 上のテストの結果 |

## 既存のテストの変更（C10-1）

1. **種類1**: `e2e/db-privileges.spec.ts`
   - 「authenticated は public のテーブルに書き込めない」
     - 期待値に `screening_presets` の DELETE・INSERT・UPDATE を足した
     - テストの名前に「・screening_presets」を足した
   - 「authenticated が実行できる public の関数」: `create_screening_preset`・`screening_preset_json`・`set_default_screening_preset`・`update_screening_preset` を足した
   - 「authenticated が参照できる public のテーブル」: `screening_presets` を足した
   - Sprint 13 の describe（2件）を新たに足した
2. **種類2**: `src/lib/ownership/memo.ts` は、空白の文字集合を `lib/text/whitespace.ts` から import するようにした。`MEMO_WHITESPACE_CLASS` などの公開名と値は同じで、`memo.test.ts`・`ownership-override.db.test.ts` は変えていない
3. **種類3**: 既存のテストの期待値は変えていない。C8-1 の「残り 不明」は新しいテストで確かめた
4. **種類4**: `beforeAll` の先頭に `await expectNoPresets();` の1行を足した（ヘルパーは `e2e/support.ts` に新設）。import に `expectNoPresets` を足しただけで、ほかの期待値は変えていない。足した spec は次の6つ
   - `e2e/screening.spec.ts`
   - `e2e/screening-detail-race.spec.ts`
   - `e2e/ownership.spec.ts`
   - `e2e/ownership-override.spec.ts`
   - `e2e/stock-detail.spec.ts`
   - `e2e/business-results.spec.ts`

## 既知の問題・未実装

1. **C2-6 の「cagr=15 は書かれない」について**
   - 最終的な URL は「厳しめ」のクエリになり、5件になる（E2E で確認）。
   - ただし、入力欄に「15」と入れた直後にセレクターを押すと、入力欄のフォーカスが外れる。そのとき Sprint 6 からの「blur で確定する」振る舞いで、`cagr=15` の `router.replace` が一度発行され、その直後にプリセットの replace で上書きされる。履歴は増えない（どちらも replace）。
   - 「一瞬も書かれない」ことは保証していない。blur で確定する振る舞いを変えると、Sprint 6 の完了条件（入力欄から離れたら反映）に影響するので、今回は変えていない。
2. **既定のプリセットを作ったときの URL**
   - 条件のパラメータの無い `/screening` を開いたまま既定のプリセットを作る・変えると、表示中の条件の URL（例 `/screening?cagr=20&…&sort=cagr&order=desc`）に置き換える。
   - そのまま `router.refresh()` すると、サーバーが新しい既定へリダイレクトし、表示中の条件が変わってしまうため（実装中に E2E で見つけて直した）。
   - 条件と結果は変わらないが、アドレスバーが `/screening` から正規形の URL に変わる。
3. **Radix のアニメーションの途中の操作**
   - メニュー・ダイアログが閉じるアニメーションの途中（約 100ms）に、トリガーを押しても開かない。
   - 開くアニメーションの途中の Esc が、下の管理のダイアログに届くことがある。
   - 人の操作ではまず起きないが、E2E では閉じ終わるのを待ってから次の操作をしている（`escape()`・`openMenu()`）。既存の部品（shadcn・Radix）の振る舞いで、アプリ側では変えていない。
4. **dev サーバーのログの `The destination stream closed early`**
   - E2E でブラウザのコンテキストを閉じたとき、中断された RSC の要求のログが2件出た。
   - 1件は既存の `screening.spec.ts` の途中のもので、プリセットとは関係しない。
   - ブラウザのコンソールのエラーは0件。
5. **C9-1**: コントラスト比は今回は計算していない（既存のトークンの組み合わせだけを使った）。
6. **マイグレーションの空白の文字集合**: 正規表現は ` ` などのエスケープで書いた。Sprint 11 のマイグレーションは文字そのものを書いているが、集合は同じ（test:db で JS の `\s` と比べている）。

## エバリュエーターに重点的に見てほしい点

- **C4-3**
  - 管理で既定を変えた直後に、再読み込みせずにヘッダーの「スクリーニング」を押したとき、新しい既定になるか（ルーターのキャッシュ）。
  - 既定を作った直後の `/screening`（上の既知の問題2）。
- **C4-12**: dev で時計のずれの状態にしたときのリダイレクト。
- **C6-1**
  - `presets.db.test.ts` の同時実行のテストは、接続1のトランザクションを開いたまま接続2を始める。接続2が `wait_event_type = 'Lock'`（`advisory`）で待っていることを `pg_stat_activity` で確かめてから、接続1を commit する。
  - 逐次の実行で成功しているのではない。
- **C5-5**: PostgREST での直接の書き込み（改行・`%2C`・全角・順番違い・重複などの拒否、`cagr=99999` と `ownermode=xyz` の通過）。
- **C2-6**: 上の既知の問題1の解釈。
