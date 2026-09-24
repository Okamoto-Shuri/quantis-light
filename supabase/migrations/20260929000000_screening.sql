-- Sprint 6: スクリーニング（条件①〜③）
--
-- public.listing_first_date_cutoff 条件③（上場 Z 年以内）を満たす最も古い初出日（基準日と閾値から1回だけ求める）
-- public.screen_stocks             絞り込み・件数・並べ替え・ページの切り出し（security invoker。RLS がそのまま効く）
-- public.screening_filter_options  業種・市場の選択肢と、データの有無（security invoker）
--
-- 性能（Sprint 4 評価の m4）: 絞り込み・件数・並べ替えでは、行ごとに年数の関数を評価しない（stock_listing_ages を使わない）。
-- 条件③は first_price_date と下限日の比較、並べ替えも初出日で行い、表示用の年数はページの行（最大100行）だけで求める。

/**
 * listing_years_between(F, p_reference).exact_years <= p_max_years となる最も古い初出日 F を返す。
 * 年数は F について非増加（F が新しいほど年数は小さいか等しい）なので、二分探索で求める。
 * 返した日以降の初出日だけが「上場 p_max_years 年以内」を満たす（データ期間開始以前の銘柄は別に除く）。
 * p_max_years が負なら、どの初出日も満たさないので NULL。どちらかが NULL なら NULL。
 */
create function public.listing_first_date_cutoff(p_reference date, p_max_years numeric)
returns date
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  lo date;
  hi date;
  mid date;
  v_exact numeric;
begin
  if p_reference is null or p_max_years is null or p_max_years < 0 then
    return null;
  end if;
  -- lo は満たさない（または探索範囲の端）、hi は満たす（基準日の年数は 0）
  lo := (p_reference - make_interval(years => ceil(p_max_years)::integer + 1))::date;
  hi := p_reference;
  select y.exact_years into v_exact from public.listing_years_between(lo, p_reference) y;
  if v_exact <= p_max_years then
    return lo;
  end if;
  while hi - lo > 1 loop
    mid := lo + (hi - lo) / 2;
    select y.exact_years into v_exact from public.listing_years_between(mid, p_reference) y;
    if v_exact <= p_max_years then
      hi := mid;
    else
      lo := mid;
    end if;
  end loop;
  return hi;
end;
$$;

comment on function public.listing_first_date_cutoff(date, numeric) is
  '条件③の下限日: listing_years_exact(F, 基準日) <= 閾値 となる最も古い初出日 F。first_price_date >= この日 ⇔ listing_years_exact <= 閾値';

/**
 * スクリーニング。p_params（アプリが検証・正規化した値）:
 *   cagr・margin・years  閾値の十進の文字列（%・%・年）。numeric で扱う（浮動小数点を経由しない）
 *   cagrOn・marginOn・yearsOn  条件のオン／オフ
 *   includeUnavailable  算出不可を含めるか
 *   markets・sectors  市場コード・33業種コードの配列（空ならすべて）
 *   sort  cagr | margin | years | code | name | market | sector、order  asc | desc
 *   page（1 から）、pageSize、clampPage（true なら最終ページを超えるページを最終ページにする）
 *
 * 条件ごとの状態: met（満たす）・unmet（満たさない）・unavailable（算出不可）・off（オフ）。
 *   オンの条件に unmet があれば除外。includeUnavailable でなければ、オンの条件に unavailable があっても除外。
 *   条件③: 初出日が無い・基準日が無い → unavailable。データ期間開始以前（first = data_start）→ unmet（仕様の定義）。
 * 並べ替え: 値の無い行は向きにかかわらず最後。同じ値はコードの昇順。
 *   推定上場年数は、年数ではなく次のキーで並べる（大きいほど古い）:
 *     年数の分かる銘柄 = −(初出日の日数)、データ期間開始以前 = 100000 −(データ期間の開始日の日数)、未確定 = NULL
 */
create function public.screen_stocks(p_params jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_cagr numeric := (p_params ->> 'cagr')::numeric / 100;
  v_margin numeric := (p_params ->> 'margin')::numeric / 100;
  v_years numeric := (p_params ->> 'years')::numeric;
  v_cagr_on boolean := coalesce((p_params ->> 'cagrOn')::boolean, true);
  v_margin_on boolean := coalesce((p_params ->> 'marginOn')::boolean, true);
  v_years_on boolean := coalesce((p_params ->> 'yearsOn')::boolean, true);
  v_include boolean := coalesce((p_params ->> 'includeUnavailable')::boolean, false);
  v_markets text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_params -> 'markets', '[]')) x), '{}');
  v_sectors text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_params -> 'sectors', '[]')) x), '{}');
  v_sort text := coalesce(p_params ->> 'sort', 'cagr');
  v_asc boolean := coalesce(p_params ->> 'order', 'desc') = 'asc';
  v_page integer := greatest(coalesce((p_params ->> 'page')::integer, 1), 1);
  v_page_size integer := least(greatest(coalesce((p_params ->> 'pageSize')::integer, 100), 1), 500);
  v_clamp boolean := coalesce((p_params ->> 'clampPage')::boolean, false);
  v_reference date;
  v_cutoff date;
  v_total integer;
  v_loose integer;
  v_strict integer;
  v_total_pages integer;
  v_rows jsonb;
begin
  if v_sort not in ('cagr', 'margin', 'years', 'code', 'name', 'market', 'sector') then
    raise exception 'screen_stocks: invalid sort %', v_sort using errcode = '22023';
  end if;
  if v_cagr is null or v_margin is null or v_years is null then
    raise exception 'screen_stocks: thresholds are required' using errcode = '22023';
  end if;

  select r.reference_date into v_reference from public.listing_reference_date r;
  -- 条件③の下限日は1回だけ求める（条件③がオフなら求めない）
  if v_years_on then
    v_cutoff := public.listing_first_date_cutoff(v_reference, v_years);
  end if;

  with cand as materialized (
    select s.code,
           case when not v_cagr_on then 'off'
                when m.revenue_cagr is null then 'unavailable'
                when m.revenue_cagr >= v_cagr then 'met' else 'unmet' end as s_cagr,
           case when not v_margin_on then 'off'
                when m.operating_margin is null then 'unavailable'
                when m.operating_margin >= v_margin then 'met' else 'unmet' end as s_margin,
           case when not v_years_on then 'off'
                when d.code is null or v_reference is null then 'unavailable'
                when d.first_price_date = d.data_start_date then 'unmet'
                when v_cutoff is not null and d.first_price_date >= v_cutoff then 'met' else 'unmet' end as s_years,
           case v_sort
             when 'cagr' then m.revenue_cagr
             when 'margin' then m.operating_margin
             when 'years' then
               case when d.code is null then null
                    when d.first_price_date = d.data_start_date then 100000 - (d.data_start_date - date '1970-01-01')
                    else -(d.first_price_date - date '1970-01-01') end
           end as num_key,
           case v_sort
             when 'code' then s.code
             when 'name' then s.company_name
             when 'market' then s.market_code
             when 'sector' then s.sector33_code
           end as txt_key
      from public.stocks s
      left join public.financial_metrics m on m.code = s.code
      left join public.stock_listing_dates d on d.code = s.code
     where (cardinality(v_markets) = 0 or s.market_code = any (v_markets))
       and (cardinality(v_sectors) = 0 or s.sector33_code = any (v_sectors))
  ),
  passed as (
    -- オンの条件に unmet が無い行（算出不可を含めるときの対象）
    select c.*,
           (c.s_cagr <> 'unavailable' and c.s_margin <> 'unavailable' and c.s_years <> 'unavailable') as complete
      from cand c
     where c.s_cagr <> 'unmet' and c.s_margin <> 'unmet' and c.s_years <> 'unmet'
  ),
  counts as (
    select count(*)::integer as loose, (count(*) filter (where p.complete))::integer as strict from passed p
  ),
  paging as (
    select n.loose, n.strict,
           case when v_include then n.loose else n.strict end as total,
           greatest(ceil((case when v_include then n.loose else n.strict end)::numeric / v_page_size)::integer, 1) as total_pages
      from counts n
  ),
  page_no as (
    select g.*, case when v_clamp and v_page > g.total_pages then g.total_pages else v_page end as page
      from paging g
  ),
  ordered as (
    select p.code, p.s_cagr, p.s_margin, p.s_years,
           row_number() over (
             order by ((p.num_key is null) and (p.txt_key is null)),
                      case when v_asc then p.num_key end asc,
                      case when not v_asc then p.num_key end desc,
                      case when v_asc then p.txt_key end asc,
                      case when not v_asc then p.txt_key end desc,
                      p.code asc
           ) as ord
      from passed p
     where v_include or p.complete
  ),
  page as materialized (
    select o.*
      from ordered o, page_no n
     where o.ord > (n.page - 1) * v_page_size and o.ord <= n.page * v_page_size
  )
  select n.total, n.loose, n.strict, n.total_pages, n.page,
         (select coalesce(jsonb_agg(
            jsonb_build_object(
              'code', s.code,
              'company_name', s.company_name,
              'market_code', s.market_code,
              'market_name', s.market_name,
              'sector33_code', s.sector33_code,
              'sector33_name', s.sector33_name,
              'revenue_cagr', m.revenue_cagr,
              'revenue_cagr_display_pct', m.revenue_cagr_display_pct,
              'revenue_cagr_unavailable_reason', m.revenue_cagr_unavailable_reason,
              'operating_margin', m.operating_margin,
              'operating_margin_display_pct', m.operating_margin_display_pct,
              'operating_margin_unavailable_reason', m.operating_margin_unavailable_reason,
              'has_financials', m.code is not null,
              'first_price_date', d.first_price_date,
              'data_start_date', d.data_start_date,
              'listed_before_data_start', case when d.code is null then null else d.first_price_date = d.data_start_date end,
              'listing_years_exact', case when d.first_price_date > d.data_start_date then y.exact_years end,
              'estimated_listing_years', case when d.first_price_date > d.data_start_date then y.rounded_up_years end,
              'listing_years_lower_bound', case when d.first_price_date = d.data_start_date then y.whole_years end,
              'status', jsonb_build_object('cagr', p.s_cagr, 'margin', p.s_margin, 'years', p.s_years)
            ) order by p.ord), '[]'::jsonb)
            from page p
            join public.stocks s on s.code = p.code
            left join public.financial_metrics m on m.code = p.code
            left join public.stock_listing_dates d on d.code = p.code
            -- 表示用の年数はページの行だけで求める（1行につき1回。データ期間開始以前は開始日から、それ以外は初出日から）
            left join lateral public.listing_years_between(
              case when d.first_price_date = d.data_start_date then d.data_start_date else d.first_price_date end,
              v_reference
            ) y on true)
    into v_total, v_loose, v_strict, v_total_pages, v_page, v_rows
    from page_no n;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'page', v_page,
    'pageSize', v_page_size,
    'totalPages', v_total_pages,
    'excludedUnavailable', case when v_include then 0 else v_loose - v_strict end,
    'referenceDate', v_reference,
    'stockCount', (select count(*) from public.stocks),
    'metricsCount', (select count(*) from public.financial_metrics),
    'listingDatesCount', (select count(*) from public.stock_listing_dates)
  );
end;
$$;

comment on function public.screen_stocks(jsonb) is
  'スクリーニング（条件①〜③）。絞り込み・件数・並べ替え・ページの切り出しを1回で行う。security invoker（RLS が効く）';

/** 業種（33業種コード順、銘柄数付き）と市場ごとの銘柄数。 */
create function public.screening_filter_options()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'sectors', coalesce((
      select jsonb_agg(jsonb_build_object('code', x.code, 'name', x.name, 'count', x.n) order by x.code)
        from (select s.sector33_code as code, min(s.sector33_name) as name, count(*) as n
                from public.stocks s
               where s.sector33_code is not null
               group by s.sector33_code) x
    ), '[]'::jsonb),
    'markets', coalesce((
      select jsonb_object_agg(x.code, x.n)
        from (select s.market_code as code, count(*) as n
                from public.stocks s
               where s.market_code is not null
               group by s.market_code) x
    ), '{}'::jsonb)
  );
$$;

create index stocks_market_code_idx on public.stocks (market_code);
create index stocks_sector33_code_idx on public.stocks (sector33_code);

revoke execute on function public.listing_first_date_cutoff(date, numeric) from public, anon, authenticated;
revoke execute on function public.screen_stocks(jsonb) from public, anon, authenticated;
revoke execute on function public.screening_filter_options() from public, anon, authenticated;
grant execute on function public.listing_first_date_cutoff(date, numeric) to authenticated, service_role;
grant execute on function public.screen_stocks(jsonb) to authenticated, service_role;
grant execute on function public.screening_filter_options() to authenticated, service_role;
