-- 氏名の後ろの注記の番号を、名前の比較と姓の取り出しから除く。
-- 実データの EDINET の有報（2026年6月提出の約 100 通を抜き取り）では、役員の氏名の欄に注記の参照が付いていることがある:
--   「浅井　亮介 （注）７．」（S100Z4PA）、「古　村　昌　人 (注)１」（S100Y8FP）、「北畑　米嗣 (注)３」（S100YL9X）
-- 今までは括弧とその中身だけを除いたので「浅井亮介7.」が残り、大株主の「浅井　亮介」と一致しなかった（社長本人・役員本人を
-- 見落とし、「社長が筆頭株主」を判定できない）。姓も「古　村　昌　人 (注)１」の部分が1文字ずつでなくなり、「古」と決めていた。
-- 「(注)」「(注3)」などの注記の括弧と、その直後の番号（「1」「7.」「1,2」「1・2」）、「※1」を除いてから、今までどおり括弧を除く。
-- 括弧の外の数字（「STATE STREET BANK AND TRUST COMPANY 505223」など）は残す。
-- 小さな immutable の SQL 関数は、呼び出し側に展開されるよう set search_path を付けない（20261003000001 と同じ）。

create or replace function public.ownership_name_key(p_name text)
returns text
language sql
immutable
parallel safe
as $$
  select translate(
           upper(translate(
             regexp_replace(
               regexp_replace(
                 regexp_replace(normalize(coalesce(p_name, ''), NFKC), '\(注[^)]*(\)|$)\s*([0-9]+[.,、・]?)*|※\s*([0-9]+[.,、・]?)*', '', 'g'),
                 '\([^)]*(\)|$)|\[[^]]*(\]|$)', '', 'g'),
               '\s+', '', 'g'),
             '髙﨑嵜邊邉濵濱齋齊澤櫻廣國德惠榮眞冨嶋嶌槗瀨證',
             '高崎崎辺辺浜浜斎斉沢桜広国徳恵栄真富島島橋瀬証')),
           'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔゕゖ',
           'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ');
$$;

comment on function public.ownership_name_key(text) is
  '氏名・名称の比較の鍵: NFKC → 注記（(注)・(注3) とその直後の番号、※1）を除く → 括弧とその中身を除く → 空白を除く → 異体字を新字体に → 大文字 → ひらがなをカタカナに';

create or replace function public.ownership_name_parts(p_name text)
returns text[]
language sql
immutable
parallel safe
as $$
  select string_to_array(
           btrim(regexp_replace(
             regexp_replace(
               regexp_replace(normalize(coalesce(p_name, ''), NFKC), '\(注[^)]*(\)|$)\s*([0-9]+[.,、・]?)*|※\s*([0-9]+[.,、・]?)*', '', 'g'),
               '\([^)]*(\)|$)|\[[^]]*(\]|$)', '', 'g'),
             '\s+', ' ', 'g')),
           ' ');
$$;

comment on function public.ownership_name_parts(text) is
  '氏名の部分（NFKC → 注記を除く → 括弧を除く → 連続した空白を1つの区切りにする）';

-- 既存の判定を新しい比較で求め直す（20261004000000 と同じ）
select public.recalculate_ownership_judgments(array(
  select distinct d.sec_code from public.edinet_documents d where d.doc_type_code in ('120', '130') and d.sec_code is not null
));
