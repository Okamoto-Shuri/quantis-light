-- Sprint 13: 評価用ユーザー（pnpm seed:users）のプリセットを消す（E2E の前提は「プリセットが0件」）。
delete from public.screening_presets
 where user_id in (select id from auth.users where email like '%@quantis.local');
