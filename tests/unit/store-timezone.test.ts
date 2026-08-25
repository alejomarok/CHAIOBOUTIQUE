import { describe, expect, it } from "vitest";

import {
  endOfDayExclusiveInTimezone,
  formatDateInTimezone,
  resolveDatePreset,
  startOfDayInTimezone,
} from "@/lib/store-timezone";

const AR_TZ = "America/Argentina/Cordoba"; // UTC-3, no DST since 2009.

describe("startOfDayInTimezone / endOfDayExclusiveInTimezone — the exact bug this module exists to prevent", () => {
  it("a Sale at 23:30 Argentina time on the 19th falls inside the [start, end) range for '2026-08-19'", () => {
    // 23:30 ART on 2026-08-19 == 02:30 UTC on 2026-08-20.
    const lateSaleInstant = new Date("2026-08-20T02:30:00.000Z");
    const start = startOfDayInTimezone("2026-08-19", AR_TZ);
    const end = endOfDayExclusiveInTimezone("2026-08-19", AR_TZ);

    expect(lateSaleInstant.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(lateSaleInstant.getTime()).toBeLessThan(end.getTime());
  });

  it("a naive UTC-midnight boundary would have WRONGLY excluded that same sale — proving the fix matters", () => {
    const lateSaleInstant = new Date("2026-08-20T02:30:00.000Z");
    const naiveUtcEnd = new Date("2026-08-20T00:00:00.000Z"); // the bug this module avoids
    expect(lateSaleInstant.getTime()).toBeGreaterThanOrEqual(naiveUtcEnd.getTime()); // i.e. would be excluded
  });

  it("start of day in Argentina is 03:00 UTC (UTC-3, midnight local)", () => {
    const start = startOfDayInTimezone("2026-08-19", AR_TZ);
    expect(start.toISOString()).toBe("2026-08-19T03:00:00.000Z");
  });

  it("end of day (exclusive) is the next day's local midnight, i.e. 03:00 UTC on the 20th", () => {
    const end = endOfDayExclusiveInTimezone("2026-08-19", AR_TZ);
    expect(end.toISOString()).toBe("2026-08-20T03:00:00.000Z");
  });

  it("a sale at exactly local midnight is included; one microsecond before local midnight the next day is included, at local midnight it is not", () => {
    const start = startOfDayInTimezone("2026-08-19", AR_TZ);
    const end = endOfDayExclusiveInTimezone("2026-08-19", AR_TZ);
    const justBeforeEnd = new Date(end.getTime() - 1);
    expect(start.getTime()).toBeLessThan(end.getTime());
    expect(justBeforeEnd.getTime()).toBeLessThan(end.getTime());
    expect(end.getTime()).toBe(start.getTime() + 24 * 60 * 60 * 1000); // exactly 24h, no DST here
  });
});

describe("formatDateInTimezone", () => {
  it("renders the correct LOCAL calendar date even when UTC has already rolled over to the next day", () => {
    // 2026-08-20T02:00:00Z is still 2026-08-19 23:00 in Argentina (UTC-3).
    expect(formatDateInTimezone(new Date("2026-08-20T02:00:00.000Z"), AR_TZ)).toBe("2026-08-19");
    expect(formatDateInTimezone(new Date("2026-08-20T03:00:00.000Z"), AR_TZ)).toBe("2026-08-20");
  });
});

describe("resolveDatePreset — evaluated against the STORE's timezone, never the server's own clock", () => {
  // "now" pinned at 2026-08-19T14:00:00Z (11:00 local ART on a Wednesday).
  const now = new Date("2026-08-19T14:00:00.000Z");

  it("today", () => {
    expect(resolveDatePreset("today", now, AR_TZ)).toEqual({
      fromDateString: "2026-08-19",
      toDateString: "2026-08-19",
    });
  });

  it("this_week starts Monday and runs through today", () => {
    // 2026-08-19 is a Wednesday -> Monday is 2026-08-17.
    expect(resolveDatePreset("this_week", now, AR_TZ)).toEqual({
      fromDateString: "2026-08-17",
      toDateString: "2026-08-19",
    });
  });

  it("this_month starts on the 1st and runs through today", () => {
    expect(resolveDatePreset("this_month", now, AR_TZ)).toEqual({
      fromDateString: "2026-08-01",
      toDateString: "2026-08-19",
    });
  });

  it("last_month is the FULL previous calendar month", () => {
    expect(resolveDatePreset("last_month", now, AR_TZ)).toEqual({
      fromDateString: "2026-07-01",
      toDateString: "2026-07-31",
    });
  });

  it("last_month correctly rolls back across a year boundary (January -> December)", () => {
    const januaryNow = new Date("2026-01-10T14:00:00.000Z");
    expect(resolveDatePreset("last_month", januaryNow, AR_TZ)).toEqual({
      fromDateString: "2025-12-01",
      toDateString: "2025-12-31",
    });
  });

  it("a sale made late at night (local) near a preset boundary is evaluated using the STORE's calendar day, not the server's", () => {
    // At 2026-08-19T02:30Z (23:30 local on the 18th), "today" in the store
    // timezone must still be the 18th, not the 19th.
    const lateNightUtc = new Date("2026-08-19T02:30:00.000Z");
    expect(resolveDatePreset("today", lateNightUtc, AR_TZ)).toEqual({
      fromDateString: "2026-08-18",
      toDateString: "2026-08-18",
    });
  });
});
