-- Sprint 7: 銘柄詳細画面
--
-- public.screening_evaluate  条件①〜③の状態と市場・業種の絞り込みの判定（スクリーニングと銘柄詳細が共有する唯一の判定の式）
-- public.screen_stocks       Sprint 6 の関数を、判定を screening_evaluate に任せる形に置き換える（振る舞いは変えない）
-- public.stock_detail        1銘柄の基本情報・初出日と表示用の年数・判定（結果に含まれるか）を1回で返す
-- public.listing_first_date_cutoff  閾値が極端に大きいときに make_interval があふれないよう、上限で丸める（Sprint 6 評価の改善提案）
--
-- いずれも security invoker（RLS がそのまま効く）。anon は実行できない。

/**
 * listing_years_between(F, p_reference).exact_years <= p_max_years となる最も古い初出日 F を返す（Sprint 6）。
 * p_max_years は 200 年で丸める（アプリの閾値の上限は 10.0 年。200 年より前の初出日はデータに存在しないので、結果は変わらない）。
 */
create or replace function public.listing_first_date_cutoff(p_reference date, p_max_years numeric)
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
  v_max numeric;
begin
  if p_reference is null or p_max_years is null or p_max_years < 0 then
    return null;
  end if;
  v_max := least(p_max_years, 200);
  -- lo は満たさない（または探索範囲の端）、hi は満たす（基準日の年数は 0）
  lo := (p_reference - make_interval(years => ceil(v_max)::integer + 1))::date;
  hi := p_reference;
  select y.exact_years into v_exact from public.listing_years_between(lo, p_reference) y;
  if v_exact <= v_max then
    return lo;
  end if;
  while hi - lo > 1 loop
    mid := lo + (hi - lo) / 2;
    select y.exact_years into v_exact from public.listing_years_between(mid, p_reference) y;
    if v_exact <= v_max then
      hi := mid;
    else
      lo := mid;
    end if;
  end loop;
  return hi;
end;
$$;

/**
 * 条件①〜③の状態（met・unmet・unavailable・off）と、市場区分・業種の絞り込みに当てはまるか（matches_filters）。
 * p_params は screen_stocks と同じ（cagr・margin・years・cagrOn・marginOn・yearsOn・markets・sectors。ほかの項目は読まない）。
 * p_codes が NULL なら全銘柄、配列ならその銘柄だけ。
 * スクリーニング（screen_stocks）と銘柄詳細（stock_detail）は、この関数だけで判定する（判定の式を二重に持たない）。
 *   条件③: 初出日が無い・基準日が無い → unavailable。データ期間開始以前（first = data_start）→ unmet（仕様の定義）。
 *   条件③の下限日は1回だけ求める（Sprint 6 の m4。行ごとに年数を計算しない）。
 */
create function public.screening_evaluate(p_params jsonb, p_codes text[] default null)
returns table (code text, s_cagr text, s_margin text, s_years text, matches_filters boolean)
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
  v_markets text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_params -> 'markets', '[]')) x), '{}');
  v_sectors text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_params -> 'sectors', '[]')) x), '{}');
  v_reference date;
  v_cutoff date;
begin
  if v_cagr is null or v_margin is null or v_years is null then
    raise exception 'screening_evaluate: thresholds are required' using errcode = '22023';
  end if;

  select r.reference_date into v_reference from public.listing_reference_date r;
  if v_years_on then
    v_cutoff := public.listing_first_date_cutoff(v_reference, v_years);
  end if;

  return query
    select s.code,
           case when not v_cagr_on then 'off'
                when m.revenue_cagr is null then 'unavailable'
                when m.revenue_cagr >= v_cagr then 'met' else 'unmet' end,
           case when not v_margin_on then 'off'
                when m.operating_margin is null then 'unavailable'
                when m.operating_margin >= v_margin then 'met' else 'unmet' end,
           case when not v_years_on then 'off'
                when d.code is null or v_reference is null then 'unavailable'
                when d.first_price_date = d.data_start_date then 'unmet'
                when v_cutoff is not null and d.first_price_date >= v_cutoff then 'met' else 'unmet' end,
           (cardinality(v_markets) = 0 or s.market_code = any (v_markets))
             and (cardinality(v_sectors) = 0 or s.sector33_code = any (v_sectors))
      from public.stocks s
      left join public.financial_metrics m on m.code = s.code
      left join public.stock_listing_dates d on d.code = s.code
     where p_codes is null or s.code = any (p_codes);
end;
$$;

comment on function public.screening_evaluate(jsonb, text[]) is
  '条件①〜③の状態と市場・業種の絞り込みの判定。screen_stocks と stock_detail が共有する唯一の判定の式。security invoker（RLS が効く）';

/**
 * スクリーニング（Sprint 6 の契約の第2章。p_params の意味・応答の形は変えない）。
 * 判定は screening_evaluate に任せ、ここでは絞り込み・件数・並べ替え・ページの切り出しと、ページの行の表示用の年数だけを行う。
 */
create or replace function public.screen_stocks(p_params jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_include boolean := coalesce((p_params ->> 'includeUnavailable')::boolean, false);
  v_sort text := coalesce(p_params ->> 'sort', 'cagr');
  v_asc boolean := coalesce(p_params ->> 'order', 'desc') = 'asc';
  v_page integer := greatest(coalesce((p_params ->> 'page')::integer, 1), 1);
  v_page_size integer := least(greatest(coalesce((p_params ->> 'pageSize')::integer, 100), 1), 500);
  v_clamp boolean := coalesce((p_params ->> 'clampPage')::boolean, false);
  v_reference date;
  v_total integer;
  v_loose integer;
  v_strict integer;
  v_total_pages integer;
  v_rows jsonb;
begin
  if v_sort not in ('cagr', 'margin', 'years', 'code', 'name', 'market', 'sector') then
    raise exception 'screen_stocks: invalid sort %', v_sort using errcode = '22023';
  end if;
  if (p_params ->> 'cagr') is null or (p_params ->> 'margin') is null or (p_params ->> 'years') is null then
    raise exception 'screen_stocks: thresholds are required' using errcode = '22023';
  end if;

  select r.reference_date into v_reference from public.listing_reference_date r;

  with cand as materialized (
    select e.code, e.s_cagr, e.s_margin, e.s_years,
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
      from public.screening_evaluate(p_params, null) e
      join public.stocks s on s.code = e.code
      left join public.financial_metrics m on m.code = e.code
      left join public.stock_listing_dates d on d.code = e.code
     where e.matches_filters
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
  'スクリーニング（条件①〜③）。判定は screening_evaluate。絞り込み・件数・並べ替え・ページの切り出しを1回で行う。security invoker（RLS が効く）';

/**
 * 銘柄詳細（Sprint 7）。銘柄マスタに無ければ NULL。
 * p_params は screen_stocks と同じ（判定の条件）。判定は screening_evaluate（スクリーニングと同じ式）。
 * included（スクリーニング結果に含まれるか）は、screen_stocks の「matches_filters かつ オンの条件に unmet が無く、
 * 算出不可を含めないときは unavailable も無い」と同じ。
 * 表示用の年数は screen_stocks・stock_listing_ages と同じ listing_years_between から求める。
 */
create function public.stock_detail(p_code text, p_params jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_include boolean := coalesce((p_params ->> 'includeUnavailable')::boolean, false);
  v_reference date;
  v_result jsonb;
begin
  select r.reference_date into v_reference from public.listing_reference_date r;

  select jsonb_build_object(
           'stock', jsonb_build_object(
             'code', s.code,
             'company_name', s.company_name,
             'market_code', s.market_code,
             'market_name', s.market_name,
             'sector33_code', s.sector33_code,
             'sector33_name', s.sector33_name
           ),
           'referenceDate', v_reference,
           'listing', case when d.code is null then null else jsonb_build_object(
             'first_price_date', d.first_price_date,
             'data_start_date', d.data_start_date,
             'listed_before_data_start', d.first_price_date = d.data_start_date,
             'listing_years_exact', case when d.first_price_date > d.data_start_date then y.exact_years end,
             'estimated_listing_years', case when d.first_price_date > d.data_start_date then y.rounded_up_years end,
             'listing_years_lower_bound', case when d.first_price_date = d.data_start_date then y.whole_years end
           ) end,
           'evaluation', jsonb_build_object(
             'status', jsonb_build_object('cagr', e.s_cagr, 'margin', e.s_margin, 'years', e.s_years),
             'matchesFilters', e.matches_filters,
             'included', e.matches_filters
               and e.s_cagr <> 'unmet' and e.s_margin <> 'unmet' and e.s_years <> 'unmet'
               and (v_include or (e.s_cagr <> 'unavailable' and e.s_margin <> 'unavailable' and e.s_years <> 'unavailable'))
           )
         )
    into v_result
    from public.stocks s
    join public.screening_evaluate(p_params, array[p_code]) e on e.code = s.code
    left join public.stock_listing_dates d on d.code = s.code
    left join lateral public.listing_years_between(
      case when d.first_price_date = d.data_start_date then d.data_start_date else d.first_price_date end,
      v_reference
    ) y on true
   where s.code = p_code;

  return v_result;
end;
$$;

comment on function public.stock_detail(text, jsonb) is
  '銘柄詳細: 基本情報・初出日と表示用の年数・条件①〜③の判定と結果に含まれるか。判定は screening_evaluate。security invoker（RLS が効く）';

revoke execute on function public.screening_evaluate(jsonb, text[]) from public, anon, authenticated;
revoke execute on function public.stock_detail(text, jsonb) from public, anon, authenticated;
grant execute on function public.screening_evaluate(jsonb, text[]) to authenticated, service_role;
grant execute on function public.stock_detail(text, jsonb) to authenticated, service_role;
