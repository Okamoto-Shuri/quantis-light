/**
 * 姓の読みの辞書（scripts/data/surname-readings.txt）から、マイグレーション
 * supabase/migrations/20261003000000_surname_readings.sql を書き出す（Sprint 10）。
 *
 *   pnpm tsx scripts/generate-surname-readings.ts
 *
 * ローマ字（ヘボン式。長音の3つの形）は src/lib/ownership/romaji.ts で読みから作り、辞書の行に書き込む。
 * 同じ姓が複数回あれば読みを合わせる。姓は比較の鍵（異体字を新字体にした形）であることを確かめる。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { romajiVariants } from "../src/lib/ownership/romaji";

const ROOT = join(__dirname, "..");
const SOURCE = join(ROOT, "scripts/data/surname-readings.txt");
const TARGET = join(ROOT, "supabase/migrations/20261003000000_surname_readings.sql");

/** DB の ownership_name_key と同じ異体字（姓の辞書に残っていてはいけない字） */
const OLD_FORMS = "髙﨑嵜邊邉濵濱齋齊澤櫻廣國德惠榮眞冨嶋嶌槗瀨證";

const readings = new Map<string, string[]>();
for (const [index, rawLine] of readFileSync(SOURCE, "utf8").split("\n").entries()) {
  const line = rawLine.trim();
  if (line === "" || line.startsWith("#")) continue;
  const match = /^(\S+)\s+(\S+)$/.exec(line);
  if (!match) throw new Error(`${index + 1} 行目の形式が不正です: ${line}`);
  const [, surname, list] = match;
  if ([...surname].some((c) => OLD_FORMS.includes(c))) throw new Error(`${index + 1} 行目: 姓は新字体で書いてください: ${surname}`);
  for (const reading of list.split(",")) {
    if (!/^[ァ-ヶー]+$/.test(reading)) throw new Error(`${index + 1} 行目: 読みはカタカナで書いてください: ${reading}`);
    if (romajiVariants(reading).length === 0) throw new Error(`${index + 1} 行目: ローマ字にできない読みです: ${reading}`);
    const current = readings.get(surname) ?? [];
    if (!current.includes(reading)) current.push(reading);
    readings.set(surname, current);
  }
}

const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;
const rows: string[] = [];
for (const [surname, list] of readings) {
  for (const reading of list) {
    rows.push(`  (${quote(surname)}, ${quote(reading)}, array[${romajiVariants(reading).map(quote).join(", ")}])`);
  }
}

const sql = `-- Sprint 10: 姓の読みの辞書（条件④の「資産管理会社（推定）」の照合に使う参照データ。市場データではない）
--
-- このファイルは scripts/generate-surname-readings.ts が scripts/data/surname-readings.txt から生成する（手で編集しない）。
-- 収録: ${readings.size} 姓・${rows.length} 読み。
-- 出典: 全国の名字ランキング（名字由来net「全国名字ランキング」、日本の苗字七千傑）の上位の姓を参考に、一般的な読みを記載した。
--       各行を出典と1件ずつ照合したものではない（辞書に無い姓・読みは、カタカナ・ローマ字の名称と照合しない。既知の制限）。
-- 姓は比較の鍵（異体字を新字体にした形）で持つ。romaji は読みのヘボン式（そのまま・長音を省く・長音を H で表す）。
-- 権限は市場データと同じ方針（RLS 有効、anon の権限なし、authenticated は許可ユーザーだけ select、書き込みは service_role のみ）。

create table public.surname_readings (
  surname text not null check (surname <> ''),
  reading text not null check (reading ~ '^[ァ-ヶー]+$'),
  romaji text[] not null default '{}',
  primary key (surname, reading)
);

comment on table public.surname_readings is
  '姓（比較の鍵）→ 読み（カタカナ）とローマ字。条件④で、社長の姓をカタカナ・ローマ字の法人名と照合するための参照データ';

insert into public.surname_readings (surname, reading, romaji) values
${rows.join(",\n")};

alter table public.surname_readings enable row level security;
revoke all on public.surname_readings from public, anon, authenticated;
grant select on public.surname_readings to authenticated;
grant all on public.surname_readings to service_role;
create policy "許可ユーザーのみ参照可" on public.surname_readings
  for select to authenticated using ((select public.current_user_is_allowed()));
`;

writeFileSync(TARGET, sql);
console.log(`${readings.size} 姓・${rows.length} 読みを ${TARGET} に書き出しました`);
