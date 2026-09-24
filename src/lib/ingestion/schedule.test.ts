import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CRON_JOBS } from "./schedule";

const vercelJson = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../vercel.json"), "utf8")) as {
  crons: { path: string; schedule: string }[];
};

describe("定期実行の設定", () => {
  it("画面に表示する設定が vercel.json の crons と一致する", () => {
    expect(vercelJson.crons).toEqual(CRON_JOBS.map((job) => ({ path: job.path, schedule: job.schedule })));
  });

  it.each(CRON_JOBS.map((job) => [job.path, job]))("%s の表示の時刻が、UTC の schedule を日本時間に直した値と一致する", (_path, job) => {
    const [minute, hour, dayOfMonth, month, dayOfWeek] = job.schedule.split(" ");
    expect([dayOfMonth, month, dayOfWeek]).toEqual(["*", "*", "*"]); // 毎日
    const jstHour = (Number(hour) + 9) % 24;
    expect(job.scheduleLabel).toBe(`毎日 ${String(jstHour).padStart(2, "0")}:${minute.padStart(2, "0")}（日本時間）`);
  });

  it("2つの定期実行は2時間以上離れている（Vercel Hobby の起動時刻のずれで重ならない）", () => {
    const hours = CRON_JOBS.map((job) => Number(job.schedule.split(" ")[1]));
    expect(Math.abs(hours[1] - hours[0])).toBeGreaterThanOrEqual(2);
  });
});
