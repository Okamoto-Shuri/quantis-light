-- Sprint 14: 比較の基準の記録をすべて消す（E2E と記録を作る pnpm test:db の前提は「記録が0件」）。
delete from public.screening_snapshots;
