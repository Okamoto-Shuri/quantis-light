-- Sprint 14 評価の m3: 取り込み状況の「うち、データ期間開始以前から上場」を、同じ区画のほかの数と同じく上場中の銘柄だけで数える。
-- ビューには外部キーが無く PostgREST で stocks を結合できないので、stock_listing_ages の末尾に delisted_on を足す
-- （create or replace view は末尾への列の追加だけを許す。既存の列と定義は変えない）。

create or replace view public.stock_listing_ages
with (security_invoker = true)
as
select
  s.code,
  d.first_price_date,
  d.data_start_date,
  ref.reference_date,
  case when d.code is null then null else d.first_price_date = d.data_start_date end as listed_before_data_start,
  case when d.first_price_date > d.data_start_date then y.exact_years end as listing_years_exact,
  case when d.first_price_date > d.data_start_date then y.rounded_up_years end as estimated_listing_years,
  case when d.first_price_date = d.data_start_date then b.whole_years end as listing_years_lower_bound,
  s.delisted_on
from public.stocks s
cross join public.listing_reference_date ref
left join public.stock_listing_dates d on d.code = s.code
left join lateral public.listing_years_between(d.first_price_date, ref.reference_date) y on true
left join lateral public.listing_years_between(d.data_start_date, ref.reference_date) b on true;

comment on view public.stock_listing_ages is
  '銘柄ごとの推定上場年数（株価データの初出日から基準日まで）。表示は estimated_listing_years（小数1桁の切り上げ）、絞り込み・並べ替えは listing_years_exact を使う。delisted_on は stocks の値（NULL = 上場中）';

revoke all on public.stock_listing_ages from public, anon, authenticated;
grant select on public.stock_listing_ages to authenticated, service_role;
