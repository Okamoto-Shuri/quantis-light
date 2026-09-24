import { describe, expect, it, vi } from "vitest";

import { installNegativeMeasureGuard } from "./measure-guard";

/** 実ブラウザと同じく、負の時刻では TypeError を投げる measure。 */
function fakePerformance() {
  const measure = vi.fn((name: string, options?: string | PerformanceMeasureOptions) => {
    if (options && typeof options === "object" && ((options.start as number) < 0 || (options.end as number) < 0)) {
      throw new TypeError(`Failed to execute 'measure' on 'Performance': '${name}' cannot have a negative time stamp.`);
    }
    return { name } as PerformanceMeasure;
  });
  return { perf: { measure } as unknown as Performance, measure };
}

describe("installNegativeMeasureGuard", () => {
  it("負の終了時刻（サーバーの時計が遅れている場合）を 0 に丸め、例外にしない", () => {
    const { perf, measure } = fakePerformance();
    installNegativeMeasureGuard(perf);
    expect(() => perf.measure("​MissingPage", { start: 0, end: -12.5 })).not.toThrow();
    expect(measure).toHaveBeenCalledWith("​MissingPage", { start: 0, end: 0 });
  });

  it("負の開始時刻も 0 に丸め、ほかの項目（detail）は変えない", () => {
    const { perf, measure } = fakePerformance();
    installNegativeMeasureGuard(perf);
    const detail = { devtools: { track: "Primary" } };
    perf.measure("x", { start: -5, end: 10, detail });
    expect(measure).toHaveBeenCalledWith("x", { start: 0, end: 10, detail });
  });

  it("正常な時刻やマーク名の指定はそのまま渡す", () => {
    const { perf, measure } = fakePerformance();
    installNegativeMeasureGuard(perf);
    perf.measure("ok", { start: 1, end: 2 });
    perf.measure("marks", "a", "b");
    expect(measure).toHaveBeenNthCalledWith(1, "ok", { start: 1, end: 2 });
    expect(measure).toHaveBeenNthCalledWith(2, "marks", "a", "b");
  });

  it("二重に入れても1回だけ包む", () => {
    const { perf, measure } = fakePerformance();
    installNegativeMeasureGuard(perf);
    installNegativeMeasureGuard(perf);
    perf.measure("once", { start: 0, end: -1 });
    expect(measure).toHaveBeenCalledTimes(1);
  });
});
