import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CRON_PATH, CRON_SCHEDULE, CRON_SCHEDULE_LABEL } from "./schedule";

const vercelJson = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../vercel.json"), "utf8")) as {
  crons: { path: string; schedule: string }[];
};

describe("定期実行の設定", () => {
  it("画面に表示する設定が vercel.json の crons と一致する", () => {
    expect(vercelJson.crons).toEqual([{ path: CRON_PATH, schedule: CRON_SCHEDULE }]);
  });

  it("表示の「毎日 20:00（日本時間）」が、UTC の schedule を日本時間に直した値と一致する", () => {
    const [minute, hour, dayOfMonth, month, dayOfWeek] = CRON_SCHEDULE.split(" ");
    expect([dayOfMonth, month, dayOfWeek]).toEqual(["*", "*", "*"]); // 毎日
    const jstHour = (Number(hour) + 9) % 24;
    const label = `毎日 ${String(jstHour).padStart(2, "0")}:${minute.padStart(2, "0")}（日本時間）`;
    expect(CRON_SCHEDULE_LABEL).toBe(label);
  });
});
