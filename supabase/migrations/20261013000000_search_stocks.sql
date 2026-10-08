-- 銘柄の検索（ヘッダーのコマンドパレット「銘柄を検索（⌘K）」。GET /api/stocks/search）
--
-- コード（前方一致）・社名（部分一致）・英文社名（部分一致）で、銘柄マスタから最大 p_limit 件を返す。
-- security invoker（RLS が効く。許可ユーザーだけが読める）。データを書き換えない。
--
-- 比較の鍵: NFKC → 空白を除く → 英字を大文字に → ひらがなをカタカナに（「とよた」で「トヨタ自動車」が見つかる）。
-- ownership_name_key は service_role だけが実行できるので使わず、同じ変換をここに書く（括弧・異体字は扱わない）。
-- 部分一致は strpos で比べる（LIKE のワイルドカード % _ を利用者の入力から解釈しない）。
--
-- 並びは「上場中 → 上場廃止」、その中で コードの完全一致（4文字は末尾に 0 を足した形も）→ コードの前方一致 → 社名の前方一致 →
-- 社名の部分一致 → 英文社名の部分一致、同じ順位はコード順。
-- 比較の鍵は全件で1回だけ求める（s を materialized にする。インライン化されると絞り込みと並べ替えで同じ式を何度も計算して
-- 4,000 銘柄で約 60ms かかった）。索引は使わない。

create function public.search_stocks(p_query text, p_limit integer default 20)
returns table (
  code text,
  company_name text,
  market_name text,
  sector33_name text,
  delisted boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select translate(
             upper(regexp_replace(normalize(coalesce(p_query, ''), NFKC), '\s+', '', 'g')),
             'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔゕゖ',
             'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ') as key
  ),
  s as materialized (
    select st.code,
           st.company_name,
           st.market_name,
           st.sector33_name,
           st.delisted_on is not null as delisted,
           translate(
             upper(regexp_replace(normalize(st.company_name, NFKC), '\s+', '', 'g')),
             'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔゕゖ',
             'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ') as name_key,
           upper(regexp_replace(normalize(coalesce(st.company_name_en, ''), NFKC), '\s+', '', 'g')) as en_key
      from public.stocks st
  ),
  ranked as (
    select s.*,
           case
             when s.code = q.key or (length(q.key) = 4 and s.code = q.key || '0') then 0
             when starts_with(s.code, q.key) then 1
             when starts_with(s.name_key, q.key) then 2
             when strpos(s.name_key, q.key) > 0 then 3
             when strpos(s.en_key, q.key) > 0 then 4
           end as rank
      from s, q
     where q.key <> ''
  )
  select r.code, r.company_name, r.market_name, r.sector33_name, r.delisted
    from ranked r
   where r.rank is not null
   order by r.delisted, r.rank, r.code
   limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

comment on function public.search_stocks(text, integer) is
  '銘柄の検索（コードの前方一致・社名・英文社名の部分一致）。ヘッダーのコマンドパレット用。security invoker。';

revoke execute on function public.search_stocks(text, integer) from public, anon, authenticated;
grant execute on function public.search_stocks(text, integer) to authenticated, service_role;
