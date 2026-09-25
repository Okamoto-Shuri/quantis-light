-- 契約（docs/harness/sprints/sprint-08/contract.md）の第5章の投入例。E2E と pnpm test:db が共有する。
-- 銘柄コード 9W001〜9W008、書類ID S8TEST…。後片付けは annual-report-cleanup.sql。
insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
values ('9W001', '検証用有報株式会社',         '0113', 'グロース',     '5250', '情報・通信業', '011'),
       ('9W002', '検証用訂正有報株式会社',     '0111', 'プライム',     '3050', '食料品',       '011'),
       ('9W003', '検証用抽出失敗株式会社',     '0112', 'スタンダード', '9050', 'サービス業',   '011'),
       ('9W004', '検証用有報未取得株式会社',   '0113', 'グロース',     '5250', '情報・通信業', '011'),
       ('9W005', '検証用取り込み待ち株式会社', '0113', 'グロース',     '5250', '情報・通信業', '011'),
       ('9W006', '検証用銀行株式会社',         '0111', 'プライム',     '7050', '銀行業',       '011'),
       ('9W007', '検証用部分訂正株式会社',     '0112', 'スタンダード', '3050', '食料品',       '011'),
       ('9W008', '検証用期不明訂正株式会社',   '0113', 'グロース',     '9050', 'サービス業',   '011');

insert into public.edinet_documents
  (doc_id, sec_code, edinet_code, filer_name, doc_type_code, ordinance_code, form_code,
   period_start, period_end, submitted_at, parent_doc_id, doc_description, withdrawn, withheld, xbrl_available, list_date)
values
  -- 9W001: 有報2通（古い事業年度の有報もあるが、新しい事業年度が使われる）
  ('S8TEST01', '9W001', 'E99001', '検証用有報株式会社', '120', '010', '030000', '2023-04-01', '2024-03-31', '2024-06-25 15:00+09', null, '有価証券報告書－第9期', false, false, true, '2024-06-25'),
  ('S8TEST02', '9W001', 'E99001', '検証用有報株式会社', '120', '010', '030000', '2024-04-01', '2025-03-31', '2025-06-25 15:00+09', null, '有価証券報告書－第10期', false, false, true, '2025-06-25'),
  -- 9W002: 有報と訂正有報（訂正は大株主・役員とも記載あり → 訂正が使われる。訂正の事業年度は元の書類から）
  ('S8TEST11', '9W002', 'E99002', '検証用訂正有報株式会社', '120', '010', '030000', '2024-04-01', '2025-03-31', '2025-06-26 15:00+09', null, '有価証券報告書－第20期', false, false, true, '2025-06-26'),
  ('S8TEST12', '9W002', 'E99002', '検証用訂正有報株式会社', '130', '010', '030001', null, null, '2025-07-10 15:00+09', 'S8TEST11', '訂正有価証券報告書－第20期', false, false, true, '2025-07-10'),
  -- 9W003: 大株主は抽出できず（比率が数値でない）、役員は XBRL の要素なし
  ('S8TEST21', '9W003', 'E99003', '検証用抽出失敗株式会社', '120', '010', '030000', '2024-04-01', '2025-03-31', '2025-06-27 15:00+09', null, '有価証券報告書－第5期', false, false, true, '2025-06-27'),
  -- 9W005: メタデータだけ（本文は未処理）
  ('S8TEST41', '9W005', 'E99005', '検証用取り込み待ち株式会社', '120', '010', '030000', null, '2025-06-30', '2025-09-24 15:00+09', null, '有価証券報告書－第3期', false, false, true, '2025-09-24'),
  -- 9W006: 銀行（業種で分岐しない）。比率は小数点以下3桁の記載
  ('S8TEST51', '9W006', 'E99006', '検証用銀行株式会社', '120', '010', '030000', '2024-04-01', '2025-03-31', '2025-06-24 15:00+09', null, '有価証券報告書－第120期', false, false, true, '2025-06-24'),
  -- 9W007: 訂正に「大株主の状況」が無い → 大株主は元の有報、役員は訂正（R3）
  ('S8TEST61', '9W007', 'E99007', '検証用部分訂正株式会社', '120', '010', '030000', '2024-04-01', '2025-03-31', '2025-06-26 15:00+09', null, '有価証券報告書－第30期', false, false, true, '2025-06-26'),
  ('S8TEST62', '9W007', 'E99007', '検証用部分訂正株式会社', '130', '010', '030001', null, null, '2025-08-05 15:00+09', 'S8TEST61', '訂正有価証券報告書－第30期', false, false, true, '2025-08-05'),
  -- 9W008: 元の書類が期間外（保存されていない）の古い訂正は、提出が新しくても選ばない（R4）
  ('S8TEST71', '9W008', 'E99008', '検証用期不明訂正株式会社', '130', '010', '030001', null, null, '2025-08-01 15:00+09', 'S8OUTSIDE', '訂正有価証券報告書－第1期', false, false, true, '2025-08-01'),
  ('S8TEST72', '9W008', 'E99008', '検証用期不明訂正株式会社', '120', '010', '030000', '2024-04-01', '2025-03-31', '2025-06-20 15:00+09', null, '有価証券報告書－第6期', false, false, true, '2025-06-20'),
  -- 届出書（証券コードなし。メタデータだけ。画面には出ない。R7）
  ('S8TEST81', null, 'E99009', '検証用上場準備株式会社', '030', '010', '020000', null, null, '2025-09-01 15:00+09', null, '有価証券届出書（新規公開時）', false, false, true, '2025-09-01');

insert into public.annual_report_extractions
  (doc_id, processed_at, shareholders_status, officers_status, shareholders_detail, officers_detail,
   officers_basis, officers_has_post_agm_table, officers_order_source)
values ('S8TEST01', now(), 'ok', 'ok', null, null, 'filing_date', false, 'inline_document'),
       ('S8TEST02', now(), 'ok', 'ok', null, null, 'filing_date', true,  'inline_document'),
       ('S8TEST11', now(), 'ok', 'ok', null, null, 'filing_date', false, 'inline_document'),
       ('S8TEST12', now(), 'ok', 'ok', null, null, 'filing_date', false, 'inline_document'),
       ('S8TEST21', now(), 'invalid_values', 'section_not_found', 'ratio_not_numeric', null, null, false, null),
       ('S8TEST51', now(), 'ok', 'ok', null, null, 'filing_date', false, 'inline_document'),
       ('S8TEST61', now(), 'ok', 'ok', null, null, 'filing_date', false, 'inline_document'),
       ('S8TEST62', now(), 'section_not_found', 'ok', null, null, 'filing_date', false, 'inline_document'),
       ('S8TEST71', now(), 'ok', 'ok', null, null, 'filing_date', false, 'inline_document'),
       ('S8TEST72', now(), 'ok', 'ok', null, null, 'filing_date', false, 'inline_document');

insert into public.annual_report_shareholders (doc_id, rank, name, address, shares_held, ratio_pct, ratio_decimals)
values
  ('S8TEST01', 1, '旧年度 太郎', '東京都', 1000000, 50.00, 2),                                    -- 古い事業年度（表示されない）
  ('S8TEST02', 1, '山田　太郎', '東京都港区', 3210000, 32.10, 2),                                 -- 個人
  ('S8TEST02', 2, '株式会社ヤマダホールディングス', '東京都港区', 1500000, 15.00, 2),           -- 法人
  ('S8TEST02', 3, '日本マスタートラスト信託銀行株式会社（信託口）', '東京都港区', 900000, 9.00, 2), -- 信託口
  ('S8TEST02', 4, 'THE BANK OF NEW YORK MELLON 140044', 'NEW YORK, U.S.A.', 120000, 1.20, 2),   -- 外国名義
  ('S8TEST02', 5, '田中　三郎', '神奈川県横浜市', 57050, 0.57, 2),                                 -- 千株で割り切れない株数・0.57%
  ('S8TEST11', 1, '訂正前 太郎', '東京都', 2000000, 20.00, 2),                                    -- 元の有報（表示されない）
  ('S8TEST12', 1, '髙橋　一郎', '大阪府大阪市', 2500000, 25.00, 2),
  ('S8TEST12', 2, '株式会社日本カストディ銀行（信託口）', '東京都中央区', 800000, 8.00, 2),
  ('S8TEST51', 1, '日本マスタートラスト信託銀行株式会社（信託口）', '東京都港区', 12000000, 12.345, 3), -- 3桁の記載
  ('S8TEST51', 2, '株式会社日本カストディ銀行（信託口４）', '東京都中央区', 5000000, 5.100, 3),
  ('S8TEST61', 1, '部分訂正 花子', '福岡県福岡市', 4000000, 40.00, 2),                            -- 9W007 はこちらが出る
  ('S8TEST71', 1, '期不明 次郎', '東京都', 100000, 1.00, 2),                                      -- 選ばれない
  ('S8TEST72', 1, '当期 四郎', '東京都', 3000000, 30.00, 2);

insert into public.annual_report_officers (doc_id, seq, name, title)
values
  ('S8TEST01', 1, '旧年度 太郎', '代表取締役社長'),
  ('S8TEST02', 1, '山田　太郎', E'代表取締役社長\n社長執行役員'),
  ('S8TEST02', 2, '佐藤　一郎', E'取締役\n（管理本部長兼経理部長）'),
  ('S8TEST02', 3, '鈴木　花子', '取締役（監査等委員）'),
  ('S8TEST11', 1, '訂正前 太郎', '代表取締役社長'),
  ('S8TEST12', 1, '髙橋　一郎', '代表取締役会長 兼 CEO'),
  ('S8TEST51', 1, '銀行　次郎', '取締役頭取（代表取締役）'),
  ('S8TEST61', 1, '訂正前 役員', '代表取締役社長'),                 -- 9W007 の役員は訂正の方が出る
  ('S8TEST62', 1, '部分訂正 花子', '代表取締役社長'),
  ('S8TEST62', 2, '新任 五郎', '取締役'),
  ('S8TEST71', 1, '期不明 次郎', '代表取締役'),
  ('S8TEST72', 1, '当期 四郎', '代表取締役社長');
