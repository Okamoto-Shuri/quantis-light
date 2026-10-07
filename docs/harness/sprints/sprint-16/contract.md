# Sprint 16 契約: F16 事業の内容（有報の最初の段落）

## 1. 対象機能

F16。銘柄詳細画面の「条件の判定」の直前に「事業の内容」のセクションを加える。中身は、有価証券報告書（有報）の「第1 企業の概況 › 3 事業の内容」の**最初の段落を原文のまま**表示したもの。

- 出典（書類ID・提出日・対象の事業年度・EDINET のリンク）を示す。
- 段落は、EDINET の取り込み（target `edinet_reports`。Sprint 8・9）が、大株主・役員と同じ書類の同じ ZIP から読む。
- 使う書類の選び方は、大株主・役員の区画（`annual_report_sections_for`）と同じ規則にそろえる。最新の提出分を使い、訂正報告書に区画が無ければ元の有報を使う。
- 取り込み状況の画面の EDINET（有報）の区画に、事業の内容の件数を加える。
- AI は使わない。要約・言い換え・全文・2段落目以降は表示しない。

### 仕様書の受け入れ基準（引用）

- AC16.1 （位置）銘柄詳細画面に「事業の内容」セクションがあり、「条件の判定」セクションのすぐ上（間にほかのセクションを挟まない）に表示される。有報の状態（取得済み・未取得・取り込み待ち・記載なし・抽出失敗）にかかわらず、セクションは同じ位置に表示される。
- AC16.2 （内容）有報の事業の内容の最初の段落を投入した銘柄では、その段落が1文字も違わずに表示される。例えば、事業の内容が次の記載の有報では、2行目の段落だけが表示され、「(1) 事業の概要」の見出しと3行目以降は表示されない。
  - 「(1) 事業の概要」（見出しだけの行）
  - 「　当社グループは、当社及び連結子会社3社で構成されており、中小企業向けのクラウド会計ソフトの開発・販売を主な事業としております。」（表示されるのは先頭の字下げを除いた文）
  - 「　当社グループの事業内容と各社の位置付けは次のとおりであります。」
  - （事業系統図の画像と、セグメントの表）
- AC16.3 （引用であることの明示）表示した段落には、「有価証券報告書『事業の内容』の冒頭の段落（原文のまま）」という趣旨のラベルが付き、AI の要約や言い換えではなく有報からの引用であることがわかる。400文字を超える長い段落でも省略記号で切られず、全文が折り返して表示される。横幅 375px の画面でも横スクロールが出ない。
- AC16.4 （出典）セクションに、引用元の有報の書類ID、提出日、対象の事業年度、EDINET の書類閲覧ページへのリンク（新しいタブで開く）が表示される。大株主・役員と同じ有報から読んだ場合は、大株主・役員の区画と同じ書類IDが表示される。
- AC16.5 （段落が無いときの状態）段落を表示できない銘柄では、ダミーの文や、社名・業種から作った文、空の枠を出さず、次のように状態を明示する。どの場合も、引用のラベル（AC16.3）は付けない。
  - 有報が1通も無い銘柄: 「有報が未取得のため、事業の内容を表示できません」
  - 使う有報の事業の内容がまだ処理されていない銘柄: 「有報（書類ID）の事業の内容は取り込み待ちです」（書類ID とリンク付き）
  - 有報に事業の内容の区画が無い銘柄: 「有報に『事業の内容』の記載が見つかりませんでした」（書類ID とリンク付き）
  - 抽出に失敗した銘柄（インライン XBRL が無い、本文の段落が見つからない、など）: 「有報から事業の内容を読み取れませんでした」と理由（書類ID とリンク付き）
- AC16.6 （訂正報告書の扱い）同じ事業年度の元の有報と訂正報告書があるときは、大株主・役員の区画と同じ規則で、新しく提出された書類の事業の内容が使われる。訂正報告書に事業の内容の区画が無い（訂正箇所だけを記載した訂正）ときは、元の有報の段落が表示され、「訂正報告書（書類ID）に記載が無いため、元の有報の記載を表示しています」という趣旨の注記が付く。取り下げられた書類・不開示の書類の段落は表示されない（取り下げを投入してリロードすると、ほかの有報の段落か AC16.5 の状態に変わる）。
- AC16.7 （新しい有報）新しい事業年度の有報の事業の内容が処理されると、リロード後の詳細画面の段落と書類IDが新しい有報のものに変わる。
- AC16.8 （導入前に処理済みの有報）この機能の導入前に大株主・役員（と主要な経営指標等）を処理済みの有報も、導入後の EDINET の取り込みで事業の内容が読まれ、詳細画面に段落が表示されるようになる。その際、大株主・役員の表示、主要な経営指標等から補った期の値、売上CAGR・営業利益率、条件④の自動判定・保有状態の内訳、手動補正、スクリーニングの結果は、導入の前後で変わらない。事業の内容まで処理済みの有報は、次の実行で取り直さない（実行履歴の処理件数で確認できる）。
- AC16.9 （取り込み状況）取り込み状況画面の EDINET（有報）の区画に、「事業の内容を取得できた銘柄」の数が「上場中の N 銘柄のうち M 銘柄」の形で表示され、事業の内容が取り込み待ちの有報の数も表示される。数は上場中の銘柄だけで数える（既存の件数と同じ数え方）。事業の内容を取得できた有報を1銘柄分投入してリロードすると、M が1増える。
- AC16.10 （キー未設定・アクセス制御）EDINET のキーが未設定の環境でも、既存の取り込みの失敗の記録（AC8.1）は変わらず、詳細画面の事業の内容は AC16.5 のいずれかの状態で表示され、ダミーの文は出ない。銘柄詳細のデータ取得用エンドポイントの応答にも、同じ段落・出典・状態が含まれ、未ログインでは返らない（AC1.6 と同じ）。
- AC16.11 （文字の安全な表示）段落に「<b>」「&amp;」「<script>alert(1)</script>」のような文字列が含まれていても、太字やスクリプトの実行にはならず、文字としてそのまま表示される。
- AC16.12 （自動テスト）事業の内容の読み取りと「最初の段落」の取り出しには、実際の有報の形をしたフィクスチャを使った自動テストがあり、通る。フィクスチャには次を含める。
  - 公開の有報の「事業の内容」の抜粋（既存の大株主・役員のフィクスチャと同じ有報でよい）
  - 見出しだけの行、空行、字下げの全角空白が段落の前にある記載
  - 表や事業系統図の画像が最初の段落より前にある記載
  - 「当社グループは…」で始まる段落、「次のとおりであります。」で終わる段落（どちらもそのまま採る）
  - 句点で終わる短い1行の段落（見出しとして飛ばさない）
  - 事業の内容の区画が無い書類、区画はあるが段落が無い書類、インライン XBRL が無い書類
  - 訂正報告書に区画が無く元の有報を使う場合

仕様の「最初の段落」の定義（1〜5）は第2章の4で、手順のレベルまで具体化する。

### 持ち越し事項・前提

- Sprint 14 評価の m1〜m4 は、コミット `1de254a` で修正済み。持ち越しは無い。
- Sprint 15（F14）は、ユーザーの決定により実施しない。F16 は F14 に依存しない。
- **並行作業（重要）**: 同じ作業ツリーで、別のセッションが「読み込み中の表示（スケルトン）」を実装中である。次のファイルに未コミットの変更がある（ステージ済みの rename を含む）。
  - `src/app/(app)/stocks/[code]/page.tsx`、`src/lib/stocks/queries.ts`、`src/app/(app)/screening/page.tsx`、`CLAUDE.md`
  - `src/app/(app)/(dashboard)/…`・`src/app/(app)/imports/(overview)/…` への移動
  - 各 `loading.tsx`、`src/components/*/…-skeleton.tsx`、`src/components/ui/skeleton.tsx`

  このスプリントでは、これらの変更を元に戻さず、上書きしない。コミットの手順は第2章の10。
  - 銘柄詳細ページは、`<Suspense fallback={<StockDetailSkeleton …/>}>` の中の `StockDetail` で本体を読む構成に変わりつつある。これを前提にする。
  - 新しいセクションは、`StockDetail` の中に置く。位置は「条件の判定」（`StockEvaluation`）を含むグリッドの直前。

## 2. 仕様上の論点と、このスプリントでの解釈

評価者は、この解釈が妥当かも判断してほしい。

### 1. 実 API・実データで確かめられない部分の扱い（Sprint 8・9 と同じ方針）

`EDINET_API_KEY` は未設定なので、書類取得 API の ZIP は取れない。

- **要素名の根拠**は2つ。
  - 金融庁「EDINET タクソノミ」（2025年版以降）の `jpcrp_cor` の要素リストで確かめる。対象は「事業の内容 [テキストブロック]」の要素で、想定は `jpcrp_cor:DescriptionOfBusinessTextBlock`。
  - キー無しで見られる実在の書類で確かめる。
- **実データの抜粋を必ず取得する**。方法は Sprint 8・9 と同じで、閲覧サイト `https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?<書類ID>,,` を headless ブラウザで開く。目次から「第1 企業の概況」の章の iframe を表示し、インライン XBRL を取り出す。
  - 対象は、既存のフィクスチャと同じ有報（S100W7OT・S100W4KN・S100W5PD）の「事業の内容」の区画。少なくとも1通は必須。
  - 抜粋は `src/lib/ingestion/edinet/__fixtures__/<書類ID>-business-description.htm` に置く。中身は、区画のテキストブロック（入れ子の要素を含む）と、参照するコンテキストだけを記載のまま残す。省くのは見た目の属性（style・class）と、事業系統図の画像の中身（`src` は空にしてよい。要素は残す）だけ。
  - 先頭のコメントには、書類ID・取得方法・省いたものを書く。
- 要素名・コンテキスト・テキストブロックの中の HTML の形（見出しの要素、段落の要素、表・画像の位置）が実データと想定で違えば、実データに合わせる。違いは self-review に書く。
- 取得できなかった形（訂正報告書、区画の無い書類、段落の無い区画など）は、`__fixtures__/synthetic.ts` の組み立ての関数で作る。その旨をフィクスチャのコメントと self-review に書く。
- テストは外部 API だけを差し替える（Sprint 3〜14 と同じ）。
- アプリの本体に、サンプルの段落・会社の説明を置かない。画面に出るのは DB の行だけで、取り込んだものか、評価者が投入したものに限る。

### 2. 取り込みの形（target は分けない。Sprint 8・9 の本文の処理に3つ目を足す）

- target は既存の `edinet_reports` のまま。定期実行（`/api/cron/edinet`）、`vercel.json`、表示名（「EDINET」「EDINET（有報・届出書）」）は変えない。
- 書類ごとの処理を3つにする。
  1. 大株主・役員（`annual_report_extractions`。Sprint 8）
  2. 主要な経営指標等（`business_results_extractions`。Sprint 9）
  3. **事業の内容（新しい `business_description_extractions`。このスプリント）**
- **本文（ZIP）を取得するのは、3つのうちどれかが未処理の書類だけ**にする。取得したら未処理の処理だけを行い、`save_edinet_extractions` で1トランザクションに保存する。処理件数は書類ごとに1。
  - 処理済みの処理は、行を消さず、書き換えず、再計算のトリガーも起こさない。保存の関数に NULL を渡す。
- 事業の内容を処理する書類は、有報（120）・訂正有報（130）だけ。届出書（030・040）では行を作らない。
- 処理済みの判定は「`business_description_extractions` に行があるか」。**抽出の規則を直して取り直すときは、その書類の行を消す**（ほかの処理の行には触れない）。
- 手動の取り込みの説明文（`manual-ingestion.tsx`）は、「有報の大株主・役員と事業の内容、有報・届出書の主要な経営指標等（上場前の期の補完）。…」に変える。対象の表示名は変えない。

### 3. 使う書類の選び方（大株主・役員の区画と同じ規則。DB の1か所）

新しい DB 関数 `business_description_sections_for(p_codes text[])` を作る。規則は `annual_report_sections_for` の大株主の列と同じで、候補の列（`annual_report_candidates_for`）を流用する。

1. 候補は `annual_report_candidates_for` の書類。銘柄ごとに対象の事業年度（`period_end`。訂正は元の書類の値）が最も新しい有報・訂正有報で、取り下げ（`withdrawn`）・不開示（`withheld`）・事業年度を決められない書類は除かれている。並びは提出日時の新しい順。
2. 候補を新しい順に見て、次のどちらかの書類で止まる。
   - 事業の内容が未処理（行が無い）→ 状態 `pending`
   - 結果が `ok` か `invalid_values`
3. `section_not_found`・`no_xbrl` の書類は飛ばして、古い書類へ進む（訂正報告書に区画が無ければ、元の有報の記載を使う）。
4. どこでも止まらなければ（すべてが `section_not_found`・`no_xbrl`）、最新の候補の結果をそのまま使う。
5. 候補が1通も無い銘柄は、行を返さない。画面では「有報が未取得」になる。
6. 使った書類が最新の候補でないときは `fallback = true`。このとき、最新の候補の書類ID・種類・提出日・結果（飛ばした理由）も返す。

- 返す列: `code`、`latest_doc_id`・`latest_doc_type_code`・`latest_submitted_at`・`latest_status`、`doc_id`・`doc_type_code`・`submitted_at`、`fiscal_period_start`・`fiscal_period_end`、`status`（`pending`／`ok`／`no_xbrl`／`section_not_found`／`invalid_values`）、`detail`、`fallback`。
- `annual_report_sections_for`・`annual_report_candidates_for`・`annual_report_detail` の定義と出力は**変えない**。条件④・大株主・役員の表示に影響させないため。
- 大株主・役員と同じ有報から読んだ場合は、同じ書類IDになる（AC16.4）。両者で区画の有無が違えば、別の書類になりうる（例: 訂正に事業の内容だけがある）。これは区画ごとに選ぶ規則の当然の結果として受け入れる。
- **取り込み待ち**: 規則 2 により、新しい訂正報告書が未処理なら、元の有報に段落があっても「取り込み待ち」を表示する。大株主・役員の表示（Sprint 8）と同じ。
  - 条件④（Sprint 10）が使う「直前の有報で補う」規則は、判定のためのものなので、ここでは使わない。

### 4. 何を抽出するか（「最初の段落」の具体化）

読むのはインライン XBRL の事実。汎用の読み取りは `edinet/xbrl.ts`、抽出は新しい `edinet/business-description.ts` で行う。

**(a) 区画（テキストブロック）の特定**
- 要素は `jpcrp_cor:DescriptionOfBusinessTextBlock`。名前空間で照合する（`annual-report.ts` の `isJpcrpCor` と同じ）。実データで違えば第2章の1に従う。
- 対象は、コンテキストの ID が `FilingDateInstant` で始まり、期間が時点で、軸・メンバーの無い事実だけ。ほかのコンテキストの事実は読まず、`discardedFacts` に数える。
- 該当する事実が無ければ `section_not_found`。
- 複数あるときは、各事実から (b) の規則で段落を取り出す。結果がすべて同じ文字列ならそれを使い、違えば `invalid_values`（`conflicting_sections`）。
- `continuedAt` 属性のある事実（Inline XBRL 1.1 の継続）は、`invalid_values`（`continuation_not_supported`）にする。EDINET は Inline XBRL 1.0（名前空間 2008）なので、ふつうは現れない。部分だけを採ることはしない。

**(b) テキストブロックの中を段落に分ける**

テキストブロックの子孫を文書の順にたどり、次の「項目」の列を作る。

| 要素 | 扱い |
|---|---|
| テキスト | 文字として加える。HTML の空白（U+0009・U+000A・U+000C・U+000D・U+0020）の連続は U+0020 1つにする（ブラウザの表示と同じ）。全角の空白（U+3000）・ノーブレークスペース（U+00A0）などは、そのまま残す |
| `br` | 段落の中の改行 |
| 区切りのブロック要素（`p` `div` `h1`〜`h6` `li` `ul` `ol` `dl` `dt` `dd` `blockquote` `section` `article` `header` `footer` `center` `pre` `address`） | 開始と終了の位置で段落を区切る |
| `table`（子孫を含む） | 「表」の項目。段落を区切る。中の文字は使わない |
| `img` `svg` `object` `figure` `picture` `canvas` | 「図」の項目。段落を区切る。代替テキスト（`alt`）は使わない |
| `hr` | 段落を区切る |
| `ix:exclude` | 中身ごと読まない |
| 入れ子の事実（`ix:nonNumeric`・`ix:nonFraction`） | 中身をたどる（本文の一部） |
| そのほかのインライン要素（`span` `a` `b` `u` `font` など） | 中身をたどる。装飾は再現しない |

- 段落の中で、改行（`br`）の間に空白しかない行（空行）があれば、そこで段落を区切る（「空行で区切られた文のまとまり」）。
- 段落の文字列は、行を U+000A でつないだものにする。改行に隣接する U+0020 は、HTML の書式による空白なので除く。それ以外の内部の文字は変えない。
- 段落の前後の空白を除く。空白の文字集合は `lib/text/whitespace.ts`（JavaScript の `\s` と同じ。U+3000・U+00A0・改行を含む）。内部の全角空白は残す。
- 文字参照（`&amp;` など）は、HTML として読んだ結果の文字にする。原文の表示の文字であり、`&amp;` は「&」になる。

**(c) 最初の段落を選ぶ**

段落を先頭から順に見て、次のものを飛ばした最初の段落を採る。

1. 空の段落（前後の空白を除いて空）。
2. 見出しだけの段落: 次の3つをすべて満たすもの。
   - 改行を含まない（1行）。
   - 最後の文字が「。」（U+3002）でも「．」（U+FF0E）でもない。
   - 長さが 40 コードポイント以下。
   - 区画の見出し（「３【事業の内容】」など）も、この規則で飛ばされる（実データで確かめる）。
3. 表・図の項目（段落として扱わない）。

- 「当社グループは、…」で始まる段落も、「…次のとおりであります。」で終わる段落も、そのまま採る。続きの段落は見ない。
- 長さで切り詰めない。採った段落が 20,000 コードポイントを超えるときは、切らずに `invalid_values`（`paragraph_too_long`）にする。実際の有報の段落はこれより十分に短い（実データで最大の長さを self-review に書く）。
- 段落が1つも残らなければ `invalid_values`（`no_paragraph`）（仕様の定義の5）。

**(d) 結果**

| 結果 | 意味 |
|---|---|
| `ok` | 段落あり |
| `no_xbrl` | XBRL の無い書類（`xbrlFlag` = 0 で要求しない）、または ZIP にインライン XBRL が無い。detail は `xbrl_flag_off`／`no_public_doc`／`no_inline_xbrl` |
| `section_not_found` | (a) の事実が無い |
| `invalid_values` | 区画はあるが段落を決められない。detail は `no_paragraph`／`conflicting_sections`／`paragraph_too_long`／`continuation_not_supported` |

- XBRL の読み取り（`readInlineXbrl`）に、指定した要素（テキストブロック）だけ、(b) のための構造（項目の列）を返す手段を足す。指定しない呼び出しの結果（事実の順・`text`・`value`・`precedingText`）は今と変えない。Sprint 8・9 の単体テストは変更なしで通ること。
- 1つの ZIP から読む XBRL は1回だけ解析し、3つの抽出に使う。

### 5. 保存（DB）

- 新しいテーブル `public.business_description_extractions`
  - `doc_id` text 主キー。`edinet_documents` を参照し、削除で連鎖する。
  - `processed_at`、`status`（check。第2章の4 の4値）、`detail`。
  - `paragraph` text。check は次のとおり。
    - `status = 'ok'` のときだけ NOT NULL。
    - 1〜20,000 コードポイント。
    - 前後に空白が無い。空白の集合は第2章の4 と同じで、Sprint 11 のメモと同じく明示した文字クラスで書く。
  - `run_id`。`ingestion_runs` を参照し、削除で NULL にする。
  - RLS・権限は `annual_report_extractions` と同じ。RLS を有効にし、anon は権限なし。authenticated かつ許可リスト登録済みのときだけ select できる。書き込みは service_role だけ。
- 再計算のトリガーは付けない（指標・判定に使わない）。進み具合のトリガー（`private.touch_ingestion_progress`、Sprint 12）だけを付ける。
- `save_edinet_extractions(p_run_id, p_doc_id, p_annual_report, p_business_results, p_business_description)`（service_role だけ）。引数を1つ足し、4引数の版は削除する。
  - `p_business_description` が NULL でなければ、その書類の行を置き換える。
  - ほかの2つの扱いは今と同じ（NULL なら触らない）。
- `edinet_ingestion_state` の対象に、事業の内容の区画で `pending` になっている書類（`business_description_sections_for(null)` の `status = 'pending'` の `doc_id`）を加える。
  - 各対象に `needsBusinessDescription` を加える。値は「種類が 120・130 で、行が無い」。
  - ほかの理由で取得する有報も、事業の内容が未処理なら一緒に処理する（同じ ZIP なので要求は増えない）。
  - 並び（Sprint 9 の優先順位）と、上場廃止の銘柄を除く規則は変えない。
- 取り込みの `details` に次を加える。既存のキーは変えない。
  - `businessDescription`（結果ごとの書類の数）
  - `documentsTargetedByKind.businessDescription`
  - `businessDescriptionDiscardedFacts`
- **導入時**（AC16.8）: マイグレーションは既存の行を変えない。新しいテーブルは空で、既存の有報（大株主・役員・主要な経営指標等は処理済み）は、事業の内容だけが未処理になる。
  - 導入後の EDINET の取り込みは、区画ごとに対象の書類を1回ずつ取得し、事業の内容だけを保存する。対象は銘柄あたり、ふつう1通。
  - このとき、`annual_report_extractions`・大株主・役員の行、`business_results_*`、`financial_metrics`、`ownership_judgments`・`ownership_holder_classifications`、`ownership_overrides` は書き換わらない（行の値も `processed_at`・`judged_at` も同じ）。
  - 初回の所要は、上場中 約 3,900 銘柄 ÷ 1回 約 190 通 ≒ 20 回。CLAUDE.md と self-review に書く。
  - この間、「未取得の残り」の注記（Sprint 12 の `remaining_count`）には、事業の内容の分が含まれる。これは正しい振る舞いとする。
  - 取り込み状況の既存のタイル「取り込み待ちの書類」（`annual-report-pending-count`。大株主・役員の区画の pending）の値は**変えない**。事業の内容の待ちは、新しいタイルの注記（`business-description-pending-count`）だけで示す（第2章の8。R2）。

### 6. 銘柄詳細の表示（AC16.1〜AC16.6・AC16.11）

**位置**
- `StockDetail` の中で、ヘッダー（と実行中の注記 `IngestionRunningNote`）の後、「条件の判定」（`StockEvaluation`）と指標のカードのグリッドの直前に、全幅のセクションとして置く。
- DOM の上では、セクションの次の要素が、`stock-evaluation` を最初の子に持つグリッドになる。間にほかのセクションを挟まない。
- 状態にかかわらず、同じ位置に同じ枠（見出し「事業の内容」）を出す。上場廃止の銘柄でも出す。

**データ**
- 新しい DB 関数 `business_description_detail(p_code text) returns jsonb`（authenticated。security invoker）。`business_description_sections_for(array[p_code])` の1行と、使った書類（`ok` なら段落）を返す。候補が無ければ NULL。
- `fetchStockPage`（`lib/stocks/queries.ts`）の並行の読み出しに、この関数の呼び出しを1つ足す。読み出しの失敗の扱いは、有報（`annual_report_detail`）と同じ（ページ全体の「銘柄の情報を読み込めませんでした」）。
- 値の形（zod）と表示の文言は、新しい `lib/stocks/business-description.ts` の1か所に置く。画面と API で共有する。

**表示（状態ごと）**

セクションの属性は `data-testid="business-description"` と `data-status`（下の表の値）。

| `data-status` | 表示 |
|---|---|
| `ok` | 下の「段落の表示」 |
| `no_annual_report`（候補なし） | 「有報が未取得のため、事業の内容を表示できません」。書類・リンクは無い |
| `pending` | 「{種類}（{書類ID}）の事業の内容は取り込み待ちです」。例「有価証券報告書（S16TEST51）の事業の内容は取り込み待ちです」。提出日と EDINET のリンクを添え、「次の EDINET の取り込みで表示されます」と書く |
| `section_not_found` | 「有報に『事業の内容』の記載が見つかりませんでした」。書類ID・提出日・リンクを添える |
| `no_xbrl`・`invalid_values` | 「有報から事業の内容を読み取れませんでした」と理由。書類ID・提出日・リンクを添える |

- `no_xbrl`・`invalid_values` の理由の文（`businessDescriptionReason`）:
  - `no_xbrl`: 「書類にインライン XBRL（機械で読めるデータ）が含まれていません」
  - `no_paragraph`: 「『事業の内容』の区画に本文の段落が見つかりません（見出し・表・図だけでした）」
  - `conflicting_sections`: 「『事業の内容』の記載が複数あり、内容が一致しません」
  - `paragraph_too_long`: 「最初の段落が長すぎます（20,000 文字を超えています）」
  - `continuation_not_supported`: 「記載が複数の箇所に分かれているため、読み取れません」
  - 未知の detail: 「『事業の内容』の記載を読み取れませんでした」
- `ok` 以外では、引用のラベルと段落の枠を出さない（空の枠を出さない）。

**段落の表示（`ok`）**
- 引用のラベル（`data-testid="business-description-label"`）は「有価証券報告書『事業の内容』の冒頭の段落（原文のまま）」。引用符のアイコンを添え、要約ではないことが一目でわかるようにする。
- 段落は `<blockquote cite="{EDINET の URL}">` の中の `<p data-testid="business-description-text">` に置く。
  - **React のテキストとして描画する**（`dangerouslySetInnerHTML` を使わない）。`<b>`・`&amp;`・`<script>` は文字のまま出る（AC16.11）。
  - 改行（U+000A）は `whitespace-pre-line` で表示する。
  - `overflow-wrap: anywhere` で、長い英数字の連続も折り返す。
  - 省略記号・行数の制限（`line-clamp`）・「続きを読む」は付けない。
  - 読みやすさのため、行の長さは 46rem 程度まで、行間は広め（日本語の本文）にする。
- 出典（`data-testid="business-description-source"`、`data-doc-id`）: 書類の種類のバッジ・書類ID・提出日（日本時間の日付）・対象の事業年度（「2025/03期（2024-04-01〜2025-03-31）」。大株主・役員の出典と同じ書き方）・EDINET のリンク（`data-testid="business-description-edinet-link"`。`target="_blank"`・`rel="noopener noreferrer"`・「新しいタブで開きます」の読み上げ）。
- **元の有報の記載のとき**（`fallback`。`data-testid="business-description-fallback"`）は、注記を caution のトークンで出す。
  - `section_not_found` のとき: 「{最新の種類} {書類ID}（{提出日} 提出）に『事業の内容』の記載が無いため、{使った種類} {書類ID}（{提出日} 提出）の記載を表示しています」
  - `no_xbrl` のとき: 「{最新の種類} {書類ID}（{提出日} 提出）からは事業の内容を読み取れない（XBRL なし）ため、…の記載を表示しています」
  - 例: 「訂正有価証券報告書 S16TEST22（2025-08-05 提出）に『事業の内容』の記載が無いため、有価証券報告書 S16TEST21（2025-06-26 提出）の記載を表示しています」
- 既存の部品の `data-testid`（`edinet-link`・`section-source`・`section-fallback`・`section-pending`・`section-failure`・`doc-type`）は使わない。新しいセクションのものは `business-description-` で始める。既存の E2E のロケーターと衝突させないため。
- デザイン: 既存のカード（`rounded-lg border bg-card p-4`、見出し `text-base font-semibold`）と同じ。状態の表示は、大株主・役員の取り込み待ち・抽出失敗と同じ形にする（破線の枠、`Hourglass`・`CircleAlert`・`CircleDashed` のアイコン、`text-muted-foreground`）。新しい色のトークンは足さない。

**読み込み中の骨組み（並行作業との関係）**
- `stock-detail-skeleton.tsx` は、別のセッションの未コミットのファイルである。
  - 実装の開始の時点でこのファイルがコミット済み（追跡されていて差分が無い）なら、同じ位置に事業の内容の枠（見出しの棒と、本文の3行の棒）を足す。
  - そうでなければ、このファイルには触れず、self-review に「骨組みに枠が無いので、読み込みの完了で本文が下にずれる」と書く。
- どちらでも、完了条件には含めない。

### 7. API（AC16.10）

`GET /api/stocks/[code]` の `data` に `businessDescription` を加える。`requireApiUser()` と `jsonNoStore` は既存のまま。形は常にオブジェクト。

```json
{
  "status": "ok",
  "detail": null,
  "reason": null,
  "paragraph": "当社グループは、…",
  "document": {
    "doc_id": "S16TEST01", "doc_type_code": "120", "doc_type_label": "有価証券報告書",
    "submitted_at": "2025-06-25T15:00:00+09:00", "period_start": "2024-04-01", "period_end": "2025-03-31",
    "edinet_url": "https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?S16TEST01,,"
  },
  "fallback": null
}
```

- `status` は第2章の6 の `data-status` と同じ6値。
- `paragraph` は `ok` のときだけ文字列（DB の値そのもの）で、ほかは null。
- `reason` は画面と同じ理由の文。`ok`・`pending`・`no_annual_report` では null。
- `document` は使った書類（`pending` は待っている書類）。`no_annual_report` では null。
- `fallback` は元の有報の記載のときだけ `{"skipped_doc_id", "skipped_doc_type_code", "skipped_doc_type_label", "skipped_submitted_at", "skipped_status"}`。ほかは null。
- 未ログインは 401（既存）。既存のキーと値は変えない。

### 8. 取り込み状況（AC16.9）

- `annual_reports_summary()` に `businessDescription` を加える。数えるのは上場中の銘柄だけ（既存と同じ `listed`）。既存のキーと値は変えない。
  - `stockCount`: 上場中の銘柄数（既存の `stockCount` と同じ値）
  - `extractedStockCount`: 区画の状態が `ok` の銘柄数
  - `pendingDocumentCount`: 区画の状態が `pending` の書類の数（重複なし）。**上場中の銘柄の書類だけを数える**（既存の `pendingDocumentCount` と同じ `listed` で絞る。R3）。上場廃止の銘柄の書類は取り込みの対象から除かれる（Sprint 12）ので、数えると 0 にならなくなるため
  - `notFoundStockCount`: `section_not_found` の銘柄数
  - `failedStockCount`: `no_xbrl`・`invalid_values` の銘柄数
- 画面: `annual-reports-panel.tsx` に新しいタイル「事業の内容を取得できた銘柄」（`data-testid="business-description-count"`）を足す。
  - 値は「上場中の N 銘柄のうち M 銘柄」。
  - 注記: 「事業の内容の取り込み待ちの有報 K 件」（`data-testid="business-description-pending-count"`）。0 でない理由ごとに「記載なし X 銘柄・読み取れなかった Y 銘柄」も添える。
  - 既存のタイルの値・見出し（「有価証券報告書（大株主・役員）」）は変えない。既存の「取り込み待ちの書類」は大株主・役員の待ちだけを数え続け、事業の内容の待ちは新しいタイルの注記だけで示す（R2）。
  - 区画の説明文は次のようにする: 「…「大株主の状況」「役員の状況」と「事業の内容」（最初の段落）を抽出します。処理済みの書類は取り直しません。1回の取り込みで処理できる書類の数には上限があるため、取り込み待ち（大株主・役員の書類と、事業の内容の有報）が残るときは「今すぐ取り込み」を続けて押すか、定期実行を待ってください。」

### 9. 性能

4,000 銘柄・有報 6,000 通（`pnpm test:db`、authenticated として）で次を測る。

| 関数 | 上限 |
|---|---|
| `business_description_detail` | 20ms 以内 |
| `annual_reports_summary`・`edinet_ingestion_state` | 変更前の同じテストの実測値（self-review に書く）の 2 倍以内 |

- 実測値は self-review に書く。

### 10. コミットの手順（並行作業があるため）

- `git add -A`・`git add .`・`git commit -a` は使わない。自分が作成・変更したファイルだけを明示的に扱う。
- コミットの前に、`git diff --cached --name-status` で、ステージにほかのセッションの変更（rename など）が無いことを確かめる。あれば、次の「一時的なインデックス」の方法でコミットする。
- 共有のファイル（`src/app/(app)/stocks/[code]/page.tsx`・`src/lib/stocks/queries.ts`・`CLAUDE.md`）について:
  - ほかのセッションの変更がコミット済みなら、通常どおり `git add <path>` する。
  - 未コミットなら、**自分の差分の hunk だけ**をコミットする。手順は次のとおり。
    1. `GIT_INDEX_FILE` に一時ファイルを指定して `git read-tree HEAD` を実行する。
    2. 自分の hunk だけのパッチを `git apply --cached` する。新しいファイルは `git add` する。
    3. `git commit` する。
    4. 実際のインデックスで `git reset -q -- <自分のパス>` を実行し、インデックスを新しい HEAD に合わせる。
  - コミットの後に、`git show --stat HEAD` と `git diff` を確かめる。ほかのセッションの変更が作業ツリーに残り、ステージ済みの rename も残っていること。
  - 自分の変更とほかのセッションの変更が同じ行で分けられないときは、そのファイルをコミットせず、呼び出し元に報告する。
- コミットメッセージは `sprint-16: 事業の内容（有報の最初の段落）`。
- `docs/harness/spec.md` の改訂3（F16。未コミット）と、Sprint 16 の契約・契約レビューを、同じコミットに含める。

## 3. 起動方法

ポート 3000 は別のプロジェクトが使っているので、すべて **3100 番**で行う。3000 番のプロセスには触れない。3100 番のサーバーを止めるときは、`lsof -ti tcp:3100` で得た PID だけを止める。

```bash
cd /Users/shuriokamoto/dev/quantis-light
pnpm install
pnpm db:start          # Docker が必要
pnpm db:reset          # Sprint 16 のマイグレーション（20261012000000_business_description.sql）を含めて適用
pnpm env:local
pnpm seed:users        # owner・owner2（許可）、intruder（許可リスト外）
# キーなし（リポジトリ直下の .env にキーがあっても、空の値で上書きする）
JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm dev -p 3100
# 本番相当（全件の E2E はこちらが標準）
pnpm build && JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm start -p 3100
```

- アプリ:
  - http://localhost:3100/stocks/9R001 （段落あり）
  - http://localhost:3100/imports （事業の内容の件数）
  - http://localhost:3100/api/stocks/9R001 （API）
- Postgres: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- 評価用ユーザー: `owner@quantis.local` / `Quantis-Owner-2026!`、`owner2@quantis.local` / `Quantis-Owner2-2026!`、`intruder@quantis.local` / `Quantis-Intruder-2026!`
- 投入例（第5章。`postgres` ユーザーで psql から流す）:
  - `e2e/fixtures/business-description-example.sql`
  - 追加 `business-description-new-fy.sql`（AC16.7）、`business-description-fill-pending.sql`（AC16.9）
  - 後片付け `business-description-cleanup.sql`
- E2E: 本番相当のサーバーを起動した状態で `E2E_PORT=3100 E2E_CRON_SECRET=local-cron-secret-0123456789 pnpm test:e2e`。DB 込みのテストは `pnpm test:db`。
- 追加する環境変数は無い。`vercel.json` も変えない。

## 4. 画面とエンドポイント

| 画面・エンドポイント | 変更 |
|---|---|
| 銘柄詳細 `/stocks/[code]` | 「事業の内容」セクション（第2章の6） |
| 取り込み状況 `/imports` | EDINET（有報）の区画のタイル（第2章の8）と、手動の取り込みの説明文（第2章の2） |
| `GET /api/stocks/[code]` | `businessDescription`（第2章の7） |

ほかの画面（ダッシュボード・スクリーニング・ウォッチリスト）は変えない。

## 5. データの保存形式と追加する DB オブジェクト

マイグレーション `supabase/migrations/20261012000000_business_description.sql`（1ファイル）。

| オブジェクト | 権限 | 内容 |
|---|---|---|
| テーブル `business_description_extractions` | authenticated は select（許可ユーザーの RLS）、書き込みは service_role | 第2章の5 |
| 関数 `business_description_sections_for(text[])` | authenticated・service_role | 選び方の1か所（第2章の3） |
| 関数 `business_description_detail(text)` | authenticated・service_role | 銘柄詳細（第2章の6） |
| 関数 `save_edinet_extractions(bigint, text, jsonb, jsonb, jsonb)` | service_role | 4引数の版は削除 |
| 関数 `edinet_ingestion_state(date, date)` | service_role（既存） | 対象に事業の内容を追加 |
| 関数 `annual_reports_summary()` | authenticated・service_role（既存） | `businessDescription` を追加 |
| トリガー | — | 新しいテーブルに `touch_ingestion_progress` |

- `e2e/db-privileges.spec.ts` の許可リストに、新しいテーブルと関数を足す。

### 投入例 `e2e/fixtures/business-description-example.sql`

銘柄コード 9R001〜9R012、書類ID S16TEST…、提出者 E99R…。中身は、銘柄（`stocks`）・`edinet_documents`・`annual_report_extractions`（一部）・`business_description_extractions` の行。期待は次の表のとおり。

| 銘柄 | 書類 | 事業の内容の行 | 期待（詳細の `data-status`・表示） |
|---|---|---|---|
| 9R001 検証用事業内容株式会社 | S16TEST00（120、2024/03期、2024-06-25 提出）と S16TEST01（120、2025/03期、2025-06-25 提出）。S16TEST01 は大株主・役員も ok（株主1名・役員1名） | S16TEST00 は ok「旧年度の段落です。」、S16TEST01 は ok で AC16.2 の段落 | `ok`。「当社グループは、当社及び連結子会社3社で構成されており、中小企業向けのクラウド会計ソフトの開発・販売を主な事業としております。」。出典 S16TEST01（大株主の出典と同じ） |
| 9R002 検証用長文株式会社 | S16TEST11（120） | ok。約 600 文字の段落。`'当社は、' \|\| repeat('検証用の長い段落の文です。', 35) \|\| 'https://example.com/' \|\| repeat('a', 120) \|\| '。'` | `ok`。全文が表示され、切れない |
| 9R003 検証用部分訂正株式会社 | S16TEST21（120、2025-06-26 提出）、S16TEST22（130、親 S16TEST21、2025-08-05 提出） | 21 は ok「元の有報の段落です。」、22 は section_not_found | `ok`、`fallback`。段落は 21 のもの。注記に S16TEST22 |
| 9R004 検証用全部訂正株式会社 | S16TEST31（120）、S16TEST32（130、親 31、後の提出） | 31 は ok「訂正前の段落です。」、32 は ok「訂正後の段落です。」 | `ok`。訂正後、出典 S16TEST32、注記なし |
| 9R005 検証用有報なし株式会社 | なし | なし | `no_annual_report` |
| 9R006 検証用取り込み待ち株式会社 | S16TEST51（120）。大株主・役員は ok（導入前に処理済みの形） | なし | `pending`。「有価証券報告書（S16TEST51）の事業の内容は取り込み待ちです」 |
| 9R007 検証用記載なし株式会社 | S16TEST61（120） | section_not_found | `section_not_found`。書類ID・リンクあり |
| 9R008 検証用段落なし株式会社 | S16TEST71（120） | invalid_values・`no_paragraph` | `invalid_values`。「読み取れませんでした」と段落なしの理由 |
| 9R009 検証用XBRLなし株式会社 | S16TEST81（120、`xbrl_available = false`） | no_xbrl・`xbrl_flag_off` | `no_xbrl`。「読み取れませんでした」と XBRL なしの理由 |
| 9R010 検証用特殊文字株式会社 | S16TEST91（120） | ok `E'当社は「<b>太字</b>」と &amp; と <script>alert(1)</script> を含む記載の検証用の会社であります。'` | `ok`。文字のまま |
| 9R011 検証用取り下げ株式会社 | S16TESTA1（120）、S16TESTA2（130、親 A1、後の提出） | A1 は ok「取り下げ前の元の段落です。」、A2 は ok「取り下げられる訂正の段落です。」 | `ok`。A2 の段落（取り下げ前） |
| 9R012 検証用上場廃止株式会社（`delisted_on` あり） | S16TESTB1（120） | ok「上場廃止の会社の段落です。」 | `ok`（詳細には出る。件数には数えない） |

- 投入直後の取り込み状況（ほかの市場データが無い DB）:
  - 上場中の 11 銘柄のうち 6 銘柄（9R001・9R002・9R003・9R004・9R010・9R011）
  - 取り込み待ちの有報 1 件（S16TEST51）
  - 記載なし 1 銘柄（9R007）、読み取れなかった 2 銘柄（9R008・9R009）
  - 既存の「有報を取得できた銘柄」などのタイルの値は、Sprint 8 の数え方のまま（このスプリントで変えない）。
- `business-description-new-fy.sql`（AC16.7）: 9R001 に S16TEST02（120、2026/03期、2026-06-25 提出）と、その事業の内容（ok「新しい事業年度の段落です。」）を入れる。
- `business-description-fill-pending.sql`（AC16.9）: S16TEST51 の事業の内容（ok「取り込み待ちだった有報の段落です。」）を入れる。投入後は 7 銘柄・取り込み待ち 0 件になる。
- `business-description-cleanup.sql`: 9R… の銘柄と S16TEST… の書類を消す（行は連鎖して消える）。

## 6. テスト可能な完了条件

すべてキーなしの環境で確かめられる。E2E は `e2e/business-description.spec.ts` に置く（C1〜C5・C7）。単体テストは `src/lib/ingestion/edinet/business-description.test.ts`、DB 込みのテストは `src/lib/stocks/business-description.db.test.ts` と `src/lib/ingestion/edinet-business-description.db.test.ts`。

### C1. 位置と状態の表示（AC16.1・AC16.5）

1. 9R001・9R005・9R006・9R007・9R008・9R009 の詳細で、`business-description` が1つだけある。
   - 見出し（role heading）は「事業の内容」。
   - `nextElementSibling` が、最初の子に `stock-evaluation` を持つ要素である。
   - `stock-evaluation` より前、`stock-header` より後のセクション（`section` 要素）は、これだけである。
2. 1280×800 で、`business-description` の下端は `stock-evaluation` の上端より上にあり、両者の間に他のセクションの要素が無い。
3. `data-status` と文言:
   - 9R005: `no_annual_report`。「有報が未取得のため、事業の内容を表示できません」
   - 9R006: `pending`。「有価証券報告書（S16TEST51）の事業の内容は取り込み待ちです」
   - 9R007: `section_not_found`。「有報に『事業の内容』の記載が見つかりませんでした」
   - 9R008: `invalid_values`。「有報から事業の内容を読み取れませんでした」と段落なしの理由
   - 9R009: `no_xbrl`。「有報から事業の内容を読み取れませんでした」と XBRL なしの理由
4. 3 の 9R006〜9R009 には、書類ID の文字と、`business-description-edinet-link`（href が `edinetViewerUrl(書類ID)`、`target=_blank`、`rel` に `noopener`）がある。9R005 にはリンクが無い。
5. 3 のどれにも、`business-description-label`・`business-description-text` が無い。セクションの文字に、社名・業種の名前（例「情報・通信業」）が含まれない。
6. 上場廃止の 9R012 でも同じ位置にセクションがあり、`ok` で段落が出る。

### C2. 内容・引用・出典（AC16.2〜AC16.4・AC16.11）

1. 9R001: `business-description-text` の `textContent` が、DB の `paragraph` と完全に一致する。値は AC16.2 の2行目の、先頭の字下げを除いた文。
   - 「(1) 事業の概要」「旧年度の段落です。」「次のとおりであります」の文字が、セクションの中に無い。
2. 9R001: `business-description-label` の文字は「有価証券報告書『事業の内容』の冒頭の段落（原文のまま）」。
3. 9R001: `business-description-source` に、次が表示される。
   - S16TEST01、提出日 2025-06-25（日本時間の日付）、対象の事業年度 2025/03期
   - EDINET のリンク。新しいタブで開き、`edinetViewerUrl('S16TEST01')`
   - `data-doc-id` は `S16TEST01`。同じページの大株主の区画の出典（`section-source` の `data-doc-id`）と同じ値
4. 9R002: `textContent` が DB の値と一致し、末尾が「。」で終わり、`…` を含まない。
   - 段落の要素の `scrollHeight` と `clientHeight` が等しい（行数の制限で隠れていない）。
   - 375×812 で、`document.documentElement.scrollWidth <= clientWidth`。1280×800 でも同じ。
5. 9R010: `textContent` が DB の値（`<b>太字</b>`・`&amp;`・`<script>alert(1)</script>` を文字として含む）と一致する。
   - セクションの中に `b`・`script` 要素が無い。
   - ページを開いてから 1 秒の間に、`dialog` のイベントが起きない。
6. 段落の描画に `dangerouslySetInnerHTML` を使っていない（評価者がソースで確かめる）。

### C3. 訂正・取り下げ・新しい有報（AC16.6・AC16.7）

1. 9R003: `data-status="ok"`、段落は「元の有報の段落です。」、`business-description-source` の `data-doc-id` は S16TEST21。
   - `business-description-fallback` の文字に「S16TEST22」と「記載が無いため」が含まれる。
2. 9R004: 段落は「訂正後の段落です。」、出典は S16TEST32。`business-description-fallback` が無い。
3. 9R011:
   1. 段落は「取り下げられる訂正の段落です。」（S16TESTA2）。
   2. `update edinet_documents set withdrawn = true where doc_id = 'S16TESTA2'` の後にリロードすると、「取り下げ前の元の段落です。」（S16TESTA1）に変わる。fallback の注記は無い。取り下げた書類は候補から外れるため。
   3. さらに S16TESTA1 も `withdrawn = true` にしてリロードすると、`no_annual_report` になる。
   4. 不開示（`withheld = true`）でも同じ結果になる（`pnpm test:db` で確かめる）。
4. 9R001 に `business-description-new-fy.sql` を流してリロードすると、段落は「新しい事業年度の段落です。」、出典は S16TEST02・2026/03期になる。
5. 9R001 で、S16TEST02 の事業の内容の行だけを消して（取り込み待ちの状態に）リロードすると、`pending`（S16TEST02）になる。古い事業年度の段落は出ない（第2章の3 の規則）。

### C4. API とアクセス制御（AC16.10）

1. ログインした owner で `GET /api/stocks/9R001` を呼ぶ。`data.businessDescription` は次のとおり。
   - `status: "ok"`、`paragraph` が DB の値と一致
   - `document.doc_id: "S16TEST01"`、`document.edinet_url` は画面のリンクと同じ
   - `fallback: null`
2. 9R003 は `fallback.skipped_doc_id: "S16TEST22"`、`skipped_status: "section_not_found"`。
3. 9R005・9R006・9R007・9R008・9R009 の `status` が、C1-3 の `data-status` と一致する。
   - `paragraph: null`
   - `reason` は画面の理由の文と同じ（9R008・9R009）
   - 9R005 は `document: null`
4. 9R010 の `paragraph` は、DB の値と同じ文字列（エスケープされた別の形ではない）。
5. 未ログインで `GET /api/stocks/9R001` は 401 で、本文に段落の文字が含まれない。許可リスト外（intruder）でも段落は返らない（既存の 401／403 の経路）。
6. キーなしの環境で、手動の「EDINET（有報・届出書）」の実行は、今までどおり「EDINET の API キーが設定されていません」で `failed` になる（AC8.1）。その後の詳細の表示は C1・C2 と同じ。

### C5. 取り込み状況（AC16.9）

1. 投入例だけの DB で `/imports` を開く。`business-description-count` は「上場中の 11 銘柄のうち 6 銘柄」、`business-description-pending-count` は 1 件。
2. `business-description-fill-pending.sql` を流してリロードすると、「上場中の 11 銘柄のうち 7 銘柄」・取り込み待ち 0 件になる。
3. 9R012（上場廃止、ok）は M に数えない。`update stocks set delisted_on = null where code = '9R012'` の後のリロードで、「上場中の 12 銘柄のうち 8 銘柄」になる（C5-2 の後の場合）。
4. 上場廃止の銘柄の書類は待ちに数えない（R3）。C5-2 の後（9R012 は上場廃止のまま）に `delete from business_description_extractions where doc_id = 'S16TESTB1'` を流してリロードしても、`business-description-pending-count` は 0 件のまま、M も 7 のまま。`select (annual_reports_summary() -> 'businessDescription' ->> 'pendingDocumentCount')::int` も 0。
   - その後 `update stocks set delisted_on = null where code = '9R012'` でリロードすると、「上場中の 12 銘柄のうち 7 銘柄」・取り込み待ち 1 件（S16TESTB1）になる。
   - C5-3 はこの項目と独立に、投入例を流し直してから確かめる。
5. 既存のタイル（有報を取得できた銘柄・大株主・役員とも抽出できた銘柄・条件④を判定できた銘柄・取り込み待ちの書類など）の値は、`annual_reports_summary()` の既存のキーの値と一致する。変更前と同じ数え方。

### C6. 抽出（単体テスト。AC16.12）

`business-description.test.ts` に次を含める。期待値は文字列の完全一致で書く。

1. 実データの抜粋（第2章の1。少なくとも1通）から、最初の段落が取り出せる。
   - 期待値は、閲覧サイトの表示と見比べた原文（前後の空白を除いたもの）。
   - 区画の見出し（「３【事業の内容】」など）は含まない。
2. AC16.2 の例をそのまま組み立てた記載: 見出しだけの行（「(1) 事業の概要」。別のケースで仕様の例「＜当社グループの事業＞」「【事業系統図】」も見出しの行として置き、飛ばされることを確かめる）→ 字下げの全角空白で始まる段落 → 「次のとおりであります。」の段落 → 画像 → 表。結果は2行目の段落で、先頭の全角空白を除いたもの。
3. 空の `p`、空白だけの `p`、`<p>&nbsp;</p>`、`<br><br>` の空行が、最初の段落より前にある記載。どれも飛ばす。
4. 表と事業系統図の画像（`alt` 付き）が最初の段落より前にある記載。表の中の文と `alt` は採らない。
5. 「当社グループは、当社及び連結子会社○社で構成されており、…」で始まり「…次のとおりであります。」で終わる段落。そのまま採り、続きの段落は採らない。
6. 句点で終わる短い1行の段落（例「当社は、不動産業を営んでおります。」、20 文字未満）。見出しとして飛ばさない。
   - 41 文字の句点の無い1行（見出しにならない）は採る。
   - 40 文字の句点の無い1行は飛ばす。「．」（U+FF0E）で終わる短い行は採る。
7. 1つの `p` の中の `<br>` 1つで2行になった段落は、改行（U+000A）を含む1つの段落として採る。見出しの規則（1行だけ）には当たらない。
8. 段落の内部の全角空白・半角記号・全角英数・括弧・「&amp;」（→「&」）・`&lt;b&gt;`（→「<b>」）を変えない。`<b>`・`<a>`・`<span>` の装飾は文字だけになる。HTML の改行・連続した空白は1つの空白になる。
9. `ix:exclude` の中の文字は採らない。入れ子の `ix:nonNumeric` の中の文字は採る。
10. 区画が無い書類は `section_not_found`。
11. 区画はあるが見出し・表・図・空の段落だけの書類は `invalid_values`・`no_paragraph`。
12. インライン XBRL の無い ZIP は `no_xbrl`・`no_inline_xbrl`。XBRL のフラグの無い書類は `no_xbrl`・`xbrl_flag_off`。
13. 異なる段落の区画が2つあれば `invalid_values`・`conflicting_sections`。同じ段落の区画が2つなら `ok`。
14. 20,000 コードポイントを超える段落は `invalid_values`・`paragraph_too_long`（切り詰めない）。20,000 ちょうどは `ok`。サロゲートペアの文字で数える。
15. `continuedAt` のある区画は `invalid_values`・`continuation_not_supported`。
16. 軸付きのコンテキスト・`FilingDateInstant` でないコンテキストの区画は読まず、`discardedFacts` に数える。
17. 既存の `annual-report.test.ts`・`business-results.test.ts`・`xbrl.test.ts` が変更なしで通る。

### C7. 書類の選び方（DB。AC16.6・AC16.12）

`src/lib/stocks/business-description.db.test.ts`（9R8xx・S16SEL…）で次を確かめる。

1. 元の有報（ok）＋訂正（section_not_found）→ 元の有報、`fallback = true`、最新は訂正。
2. 元の有報（ok）＋訂正（no_xbrl）→ 元の有報、`fallback = true`、`latest_status = 'no_xbrl'`。
3. 元の有報（ok）＋訂正（invalid_values）→ 訂正の失敗（止まる）。
4. 元の有報（ok）＋訂正（未処理）→ `pending`（訂正）。
5. 訂正が2通（どちらも ok）→ 提出が新しい方。
6. 候補がすべて section_not_found → 最新の書類の section_not_found。
7. 取り下げ・不開示の書類は使わない。事業年度を決められない訂正（親が期間外）も使わない（Sprint 8 の R4 と同じ）。
8. 古い事業年度の有報に段落があっても、新しい事業年度の有報の状態を使う（pending・失敗を含む）。
9. 大株主・役員の区画（`annual_report_sections_for`）が同じ書類を選ぶ構成では、`doc_id` が一致する。
10. 権限:
    - authenticated（許可ユーザー）は `business_description_detail` を実行でき、テーブルを select できる。
    - 許可リスト外の authenticated と anon は、行を読めない。
    - authenticated はテーブルに insert・update・delete できない。
    - `save_edinet_extractions` は service_role だけが実行できる。
11. 性能（第2章の9）。4,000 銘柄・6,000 通（D0000〜D3999・S16PERF…）で測り、`console.log` で実測値を残す。

### C8. 取り込みと導入前の書類（DB 込みの結合テスト。AC16.8）

`src/lib/ingestion/edinet-business-description.db.test.ts`（9R9xx・S16DB…・E9R…、書類一覧の `list_date` は 2007 年。時計を 2007 年にする）。外部 API（書類一覧・書類取得）だけを差し替え、ZIP はフィクスチャから組み立てる。

1. **導入前に処理済みの有報**: 用意する書類は次のとおり。
   - 有報 3 通。`annual_report_extractions`（大株主・役員の行あり）と `business_results_extractions`・`business_results_periods` は処理済みで、事業の内容は未処理。
   - 決算短信の期・手動補正（owner の `ownership_overrides`）のある銘柄を含める。
   - 書類一覧は取得済みにする。

   実行の前に、次の値を記録する。
   - `annual_report_detail`（3銘柄）
   - `annual_report_extractions`・`annual_report_shareholders`・`annual_report_officers`・`business_results_extractions`・`business_results_periods` の全列（`processed_at` を含む）
   - `financial_periods`・`financial_metrics`
   - `ownership_judgments`・`ownership_holder_classifications` の全列（`judged_at` を含む）
   - `ownership_overrides`
   - owner として呼んだ `screen_stocks`（既定の条件）

   EDINET の取り込みを1回実行した後、次を確かめる。
   - 3通の事業の内容が `ok` で保存されている。
   - 実行の `processed_count` は 3、`details.businessDescription.ok` は 3。
   - 記録した値はすべて実行前と同じ。
   - 書類取得 API の要求は3回（1通1回）。
2. 同じ条件で2回目の実行をすると、書類取得 API の要求は0回、`processed_count` は 0。
3. 未処理の新しい有報（3つの処理がすべて未処理）を1通足して実行すると、要求は1回、3つの処理の行がすべて作られる。
4. 大株主・役員だけが未処理の有報（事業の内容は処理済み）では、`p_business_description` に NULL が渡り、事業の内容の行は書き換わらない（`processed_at` が同じ）。
5. `edinet_ingestion_state` の `targets` に `needsBusinessDescription` があり、届出書（030・040）では常に false。
6. 期限・打ち切りで処理されなかった書類は、次の実行で処理される（Sprint 8 の骨組みのまま）。実行の `remaining_count` に事業の内容の待ちが含まれる。
7. **訂正報告書に区画が無く元の有報を使う場合（AC16.12。R1）**: `synthetic.ts` で組み立てた次の2通の ZIP を、書類取得 API の差し替えで返す。
   - 元の有報（120。事業の内容の区画あり。大株主・役員もあり）
   - 訂正有報（130。親はその有報。大株主・役員などはあるが `DescriptionOfBusinessTextBlock` が無い）

   取り込みを実行した後、次を確かめる。
   - 訂正の行は `section_not_found`、元の有報の行は `ok`（段落はフィクスチャの期待値と完全一致）
   - `business_description_detail` が元の有報の段落を返し、`fallback` が真で、飛ばした書類（`latest`）は訂正、`latest_status` は `section_not_found`
   - 大株主・役員の区画（`annual_report_sections_for`）の選択は従来どおり（訂正に大株主・役員があれば訂正を選ぶ）
8. 後片付けは自分の接頭辞の行だけを消す。

### C9. リグレッション・品質

1. **既存のテストの変更の範囲**: 変えてよいのは次の種類だけ。
   1. `e2e/db-privileges.spec.ts` の許可リストに、新しいテーブル・関数を足すこと。`save_edinet_extractions` の引数の型の文字列を変えること。
   2. 既存の EDINET の取り込みの結合テスト（`edinet-*.db.test.ts`）で、`save_edinet_extractions` の呼び出し・`details` のキー・本文の要求の回数・処理件数の期待値を、事業の内容の処理が加わった分だけ変えること。
      - 例: 大株主・役員を処理済みの有報が、事業の内容のために1回取得される。
      - 変える理由をテストのコメントに書く。
   3. 取り込み状況の区画のタイルの数・並びの期待値に、新しいタイルを足すこと。
   4. 詳細のページで、既存のロケーターが新しいセクションの文字（「取り込み待ち」「EDINET で開く」など）と重なって strict mode の違反になるとき、ロケーターを既存の区画の中に絞ること。期待値は変えない。

   ほかの期待値は変えない。self-review に、変えたアサーションを、ファイル・行と前後の値つきで一覧にする。想定外の変更が要るときは、理由を self-review に書き、呼び出し元に報告する。
2. Sprint 1〜14 の完了条件が引き続き満たされる（評価者の判断で抜き取り確認）。特に次の点。
   - 詳細の大株主・役員（Sprint 8）、出典と5期の表（Sprint 9）、条件④の判定根拠・保有状態（Sprint 10）、手動補正（Sprint 11）
   - 取り込み状況の EDINET の区画、実行の詳細（Sprint 12）
3. `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:db`、`pnpm build` がすべて成功する。
4. 本番相当のサーバー（キーなし）で `E2E_PORT=3100 pnpm test:e2e` がすべて成功する。dev でも `e2e/business-description.spec.ts` と `e2e/stock-detail.spec.ts` が成功する（後者は時計のずれの検査を含む）。
   - E2E の後、DB は開始前の状態に戻る（`afterEach` と `afterAll` で後片付けの SQL を流す）。
5. ブラウザのコンソールに、詳細・取り込み状況でエラーが出ない。
6. コミット（第2章の10）。
   - `sprint-16: 事業の内容（有報の最初の段落）` でコミットされている。
   - コミットに、ほかのセッションの変更（スケルトン・rename・`CLAUDE.md` のその部分）が含まれず、作業ツリーにそのまま残っている。
7. `CLAUDE.md` に次が追記されている（自分の追記の hunk だけをコミット）。
   - **「現状」**: Sprint 16（F16）まで実装済み。
   - 「事業の内容（Sprint 16。F16）」の節。次を書く。
     - 処理の3つ目（`business_description_extractions`）と、本文を取得する条件
     - 選び方の1か所（`business_description_sections_for`）と、`annual_report_sections_for` を変えないこと
     - 「最初の段落」の規則の要約と、抽出を直したときの取り直しの方法（行を消す）
     - 画面・API・取り込み状況の位置と `data-testid`
     - 導入時の初回の所要（約 20 回）
     - テストの接頭辞（9R…・S16…・E99R…・E9R…・D0000〜D3999）と後片付け
     - 既知の制限
8. self-review に次を書く。
   - C9-1 の変更の一覧、C7-11 の実測値、実データで確かめた点・確かめられなかった点
   - マイグレーションに、既存のテーブルへの DML（insert・update・delete）が無いこと（AC16.8 の「導入の前後で変わらない」のうち、マイグレーションそのものの部分。評価者もファイルで確かめる）
   - 実データの抜粋で、HTML のソースの改行が和文の途中にあり、第2章の4(b) の規則で表示に半角空白が入るかどうか。入るなら、和文の文字に挟まれた空白の扱いを報告する

## 7. 評価者への補足

- すべての完了条件は、キーなしの環境で確かめられる。段落は `business_description_extractions` に直接投入する（`postgres` ユーザー。RLS を迂回する。トリガーと check 制約は通る）。
- 取り込み（AC16.8）の確認は、DB 込みの結合テスト（C8）で行う。キーが無いので、実際の EDINET の取り込みは動かせない。テストは外部 API だけを差し替え、DB 関数・保存・トリガーは本物を通る。
- 抽出の規則（第2章の4）は、`business-description.test.ts`（C6）で確かめる。実データの抜粋の期待値は、閲覧サイト（`WZEK0040.aspx?<書類ID>,,`）の表示と見比べられる。
- 鮮度の警告の境（投入例の株価の成功の終了の 48 時間後）の後に評価する場合、事業の内容のセクションは警告と一緒に描画されればよい。

## 8. 今回やらないこと（後続スプリント・スコープ外）

- AI（LLM）による要約・言い換え。「事業の内容」の全文や2段落目以降の表示、「続きを読む」。
- 事業系統図・セグメントの表の表示、収入・支出の内訳の円グラフ。
- 事業の内容の文によるスクリーニング・全文検索、一覧（スクリーニング・ウォッチリスト）での表示。
- 有価証券届出書の事業の内容（有報が無い新規上場の直後の銘柄は「有報が未取得」）。
- 原文の装飾（太字・下線・リンク）の再現。
- Inline XBRL 1.1 の継続（`continuedAt`）の結合。EDINET の 1.0 では現れないため、現れたら抽出の失敗にする。
- 書類一覧の期間（450 日）より前の有報の取得（Sprint 8 の既知の制限のまま）。

## 9. 改訂履歴

- rev 0（2026-10-07）: 初版。
- rev 1（2026-10-07）: 契約レビュー（contract-review.md）の反映。
  - R1: C8-7 に、訂正有報に区画が無く元の有報を使う場合を、ZIP のフィクスチャから取り込みで確かめる項目を足した。
  - R2: 既存の「取り込み待ちの書類」のタイルは変えず、事業の内容の待ちは新しいタイルの注記だけで示すことにした（第2章の5・8）。区画の説明文を直した。
  - R3: 事業の内容の取り込み待ちの数も上場中の銘柄の書類だけで数えることを明記し（第2章の8）、C5-4 を足した。
  - 改善提案: C6-2 に仕様の見出しの例を加えた。pending の文言の書式の余分な空白を除いた。self-review に、マイグレーションに既存のテーブルへの DML が無いことと、和文の途中の空白の扱いを書くことにした（C9-8）。
