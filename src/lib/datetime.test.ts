import { afterEach, describe, expect, it, vi } from "vitest";
import { nowAsDatetimeLocalValue, toDatetimeLocalValue } from "./datetime";

describe("toDatetimeLocalValue", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("represents local wall-clock time, not raw UTC", () => {
    // 15:00 UTC in a UTC-3 timezone (Brasília) is 12:00 local - the bug this
    // guards against is rendering "15:00" (3 hours ahead) instead of "12:00".
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(180);
    const utcMoment = new Date("2026-08-06T15:00:00.000Z");

    expect(toDatetimeLocalValue(utcMoment)).toBe("2026-08-06T12:00");
  });

  it("does not shift when the timezone is UTC", () => {
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(0);
    const utcMoment = new Date("2026-08-06T15:00:00.000Z");

    expect(toDatetimeLocalValue(utcMoment)).toBe("2026-08-06T15:00");
  });

  it("shifts forward for positive UTC timezones", () => {
    // UTC+9 (Japan): getTimezoneOffset is negative (-540).
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-540);
    const utcMoment = new Date("2026-08-06T15:00:00.000Z");

    expect(toDatetimeLocalValue(utcMoment)).toBe("2026-08-07T00:00");
  });

  it("produces a value directly usable as a datetime-local input value", () => {
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(180);
    const value = toDatetimeLocalValue(new Date("2026-08-06T15:05:00.000Z"));

    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

describe("nowAsDatetimeLocalValue", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("captures the current moment each time it is called, without drifting or freezing", () => {
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(180);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T15:00:00.000Z"));

    const first = nowAsDatetimeLocalValue();
    expect(first).toBe("2026-08-06T12:00");

    // Simulates closing and reopening the dialog later - a fresh call must
    // reflect the new "now", not the value captured on the earlier call.
    vi.setSystemTime(new Date("2026-08-06T15:07:00.000Z"));
    const second = nowAsDatetimeLocalValue();
    expect(second).toBe("2026-08-06T12:07");
    expect(second).not.toBe(first);
  });
});
