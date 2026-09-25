-- Sprint 14: 評価用ユーザー（pnpm seed:users）のウォッチリストを消す（E2E の前提は「ウォッチリストが0件」）。
delete from public.watchlist_items
 where user_id in (select id from auth.users where email like '%@quantis.local');
