import { describe, expect, it } from "vitest";

import { isSameOriginRequest } from "./same-origin";

const h = (values: Record<string, string>) => new Headers(values);

describe("isSameOriginRequest", () => {
  it("Origin のホストが Host と一致すれば受け付ける（localhost 以外のホスト名でも）", () => {
    expect(isSameOriginRequest(h({ origin: "http://127.0.0.1:3100", host: "127.0.0.1:3100" }))).toBe(true);
    expect(isSameOriginRequest(h({ origin: "http://localhost:3100", host: "localhost:3100" }))).toBe(true);
    expect(isSameOriginRequest(h({ origin: "https://quantis.example.com", host: "quantis.example.com" }))).toBe(true);
  });

  it("X-Forwarded-Host があればそれ（複数の値なら最初の値）と比べる", () => {
    const base = { origin: "https://app.example.com", host: "internal:3000" };
    expect(isSameOriginRequest(h({ ...base, "x-forwarded-host": "app.example.com" }))).toBe(true);
    expect(isSameOriginRequest(h({ ...base, "x-forwarded-host": "app.example.com, proxy.local" }))).toBe(true);
    expect(isSameOriginRequest(h({ ...base, "x-forwarded-host": "proxy.local, app.example.com" }))).toBe(false);
  });

  it("大文字小文字は区別しない。ポートの違いは拒否する", () => {
    expect(isSameOriginRequest(h({ origin: "http://LOCALHOST:3100", host: "localhost:3100" }))).toBe(true);
    expect(isSameOriginRequest(h({ origin: "http://localhost:3101", host: "localhost:3100" }))).toBe(false);
    expect(isSameOriginRequest(h({ origin: "http://localhost", host: "localhost:3100" }))).toBe(false);
    expect(isSameOriginRequest(h({ origin: "https://example.com", host: "example.com" }))).toBe(true);
  });

  it("Origin が無い・null・壊れている・別のホストなら拒否する", () => {
    expect(isSameOriginRequest(h({ host: "localhost:3100" }))).toBe(false);
    expect(isSameOriginRequest(h({ origin: "null", host: "localhost:3100" }))).toBe(false);
    expect(isSameOriginRequest(h({ origin: "not a url", host: "localhost:3100" }))).toBe(false);
    expect(isSameOriginRequest(h({ origin: "file://localhost:3100", host: "localhost:3100" }))).toBe(false);
    expect(isSameOriginRequest(h({ origin: "https://evil.example", host: "localhost:3100" }))).toBe(false);
    expect(isSameOriginRequest(h({ origin: "http://localhost:3100" }))).toBe(false);
  });
});
