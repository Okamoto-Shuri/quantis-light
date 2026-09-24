import { describe, expect, it, vi } from "vitest";

import { calendarResponse } from "./__fixtures__/fins-summary";
import { parseCalendar, requestCalendarPage } from "./calendar";

describe("取引カレンダー", () => {
  it("休日区分 1（営業日）と 2（半日立会日）だけを営業日にする。0 と 3 は除く", () => {
    const page = parseCalendar(
      calendarResponse([
        { date: "2026-09-18", holDiv: "1" },
        { date: "2026-09-19", holDiv: "3" },
        { date: "2026-09-20", holDiv: "0" },
        { date: "2026-12-30", holDiv: "2" },
      ]),
    );
    expect(page).toEqual({ kind: "rows", businessDays: ["2026-09-18", "2026-12-30"], paginationKey: null });
  });

  it("形式が違えば invalid_format", () => {
    expect(parseCalendar({ data: [{ Date: "2026-09-18" }] }).kind).toBe("invalid_format");
    expect(parseCalendar({}).kind).toBe("invalid_format");
  });

  it("from・to・pagination_key を付けて要求する", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(calendarResponse([])), { status: 200 }));
    await requestCalendarPage({ apiKey: "k", from: "2020-09-24", to: "2026-09-24", paginationKey: "p", fetchImpl });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://api.jquants.com/v2/markets/calendar?from=2020-09-24&to=2026-09-24&pagination_key=p",
    );
  });
});
