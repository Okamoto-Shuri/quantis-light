-- Sprint 14: ウォッチリストの投入例（契約の第5章）。owner の4件。postgres ユーザーで実行する。
-- 市場データは Sprint 10 の ownership-example.sql（9U001〜9U014）を使う。後片付けは watchlist-cleanup.sql。
-- 追加日時（created_at）はトリガーが insert で now() にするので、表示を確かめるための固定の日時は、このファイルの中だけトリガーを外して入れ直す。
insert into public.watchlist_items (user_id, code, memo)
select u.id, w.code, w.memo
  from auth.users u
 cross join (values
   ('9U004', null),
   ('9U011', E'成長率の回復待ち\n来期の予想を見る'),
   ('9U006', null),
   ('9U001', '決算説明会の資料を確認する')
 ) as w(code, memo)
 where u.email = 'owner@quantis.local';

alter table public.watchlist_items disable trigger watchlist_items_before_write;
update public.watchlist_items w
   set created_at = v.created_at, updated_at = v.created_at
  from (values ('9U004', timestamptz '2026-09-20 10:00+09'), ('9U011', timestamptz '2026-09-21 10:00+09'),
               ('9U006', timestamptz '2026-09-22 10:00+09'), ('9U001', timestamptz '2026-09-23 10:00+09')) as v(code, created_at)
 where w.code = v.code and w.user_id = (select id from auth.users where email = 'owner@quantis.local');
alter table public.watchlist_items enable trigger watchlist_items_before_write;
