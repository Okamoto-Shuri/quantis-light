-- 取り込み状況の「初出日の新しい銘柄」を速くする（本番で1回 約1秒かかり、取り込み中の画面の取り直しで DB を詰まらせていた）。
-- ビュー stock_listing_ages を listed_before_data_start = false・first_price_date の降順で絞ると、RLS の条件と横結合のために
-- stocks と stock_listing_dates の結合が索引を使わない入れ子ループ（約 3,700 × 3,700 回の比較）になる。
-- 先に stock_listing_dates の索引（first_price_date）で上位 N 銘柄のコードを選び、そのコードだけビューから読む。
-- 値はビューの行そのもの（年数の算出は今までどおり DB の1か所）。条件と並びはビューへの問い合わせと同じ:
-- listed_before_data_start = false（初出日の行があり、初出日 ≠ データ期間の開始日）、初出日の新しい順 → コード順。

create or replace function public.recent_listing_ages(p_limit integer)
returns setof public.stock_listing_ages
language sql
stable
security invoker
set search_path = ''
as $$
  select a.*
    from public.stock_listing_ages a
   where a.code in (
     select d.code
       from public.stock_listing_dates d
      where d.first_price_date <> d.data_start_date
      order by d.first_price_date desc, d.code
      limit greatest(coalesce(p_limit, 0), 0)
   )
   order by a.first_price_date desc, a.code;
$$;

comment on function public.recent_listing_ages(integer) is
  '初出日の新しい銘柄（データ期間開始以前の銘柄を除く）の推定上場年数。stock_listing_ages の行を p_limit 件まで、初出日の新しい順 → コード順で返す';

revoke all on function public.recent_listing_ages(integer) from public, anon, authenticated;
grant execute on function public.recent_listing_ages(integer) to authenticated, service_role;
