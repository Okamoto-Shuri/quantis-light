-- Sprint 13: 条件プリセットの投入例（契約の第5章）。owner の3件、既定なし。postgres ユーザーで実行する。
-- 行の中身（日時・名前の前後の空白）はトリガーが決める。作成の順が表示の順（1文の中でも clock_timestamp() で順に並ぶ）。
-- 市場データは Sprint 10 の ownership-example.sql（9U001〜9U014）を使う。後片付けは screening-presets-cleanup.sql。
insert into public.screening_presets (user_id, name, query)
select u.id, p.name, p.query
  from auth.users u
 cross join (values
   (1, 'グロースのみ', 'cagr=20&margin=10&years=5&owner=20&ownermode=any&market=0113&sort=cagr&order=desc'),
   (2, '厳しめ', 'cagr=20&margin=10&years=5&owner=40&ownermode=any&sort=owner&order=desc'),
   (3, 'スタンダード④なし', 'cagr=20&margin=10&years=5&owner=20&ownermode=any&off=owner&market=0112&sort=code&order=asc')
 ) as p(ord, name, query)
 where u.email = 'owner@quantis.local'
 order by p.ord;
