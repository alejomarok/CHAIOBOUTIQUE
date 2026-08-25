// Pure — no "server-only", no DB import. Timezone-correct calendar-day
// boundary resolution with zero external dependencies (Intl.DateTimeFormat
// covers this without a library). This exists specifically to avoid the
// classic bug this phase's spec calls out by name: interpreting a "Desde/
// Hasta" calendar-day filter in UTC would clip off the last few hours of an
// Argentine business day (UTC-3) — a Sale made at 23:00 local time on the
// 19th is still 02:00 UTC on the 20th, and a naive `new Date("2026-08-19")`
// UTC-midnight boundary would wrongly exclude it from "19/08/2026".
//
// StoreConfiguration.timezone (see modules/store-settings) is a plain IANA
// zone string, e.g. "America/Argentina/Cordoba" — this module works for any
// valid IANA zone, not just Argentina's (which happens to have no DST since
// 2009, but this code never assumes that).

// The offset (in minutes, UTC minus local — i.e. what to ADD to a UTC
// instant to get local wall-clock time) that `timeZone` actually observes
// at the given instant. Computed by asking Intl what wall-clock time this
// exact instant renders as, then diffing — correct across DST transitions
// (though evaluated once per call, not per instant, so it assumes the
// offset is stable across the ~24h span it's applied to, which holds for
// every timezone except the literal calendar day of a DST transition).
function timezoneOffsetMinutesAt(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((p) => [p.type, p.value]));
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asIfUtc - instant.getTime()) / 60_000;
}

// "YYYY-MM-DD" representation of `instant` as seen in `timeZone` — used to
// determine "what calendar day is 'today' in the store's own timezone",
// never the server process's own local time or naive UTC.
export function formatDateInTimezone(instant: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return formatter.format(instant); // en-CA formats as YYYY-MM-DD directly
}

// The UTC instant corresponding to local midnight (00:00:00) of the given
// "YYYY-MM-DD" calendar date, as observed in `timeZone`.
export function startOfDayInTimezone(dateString: string, timeZone: string): Date {
  const [year, month, day] = dateString.split("-").map(Number);
  const naiveUtcGuess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const offsetMinutes = timezoneOffsetMinutesAt(naiveUtcGuess, timeZone);
  return new Date(naiveUtcGuess.getTime() - offsetMinutes * 60_000);
}

// Exclusive upper bound: local midnight of the NEXT calendar day — pairing
// [startOfDayInTimezone(d), endOfDayExclusiveInTimezone(d)) as a `>=`/`<`
// range is what correctly captures every Sale made anywhere within that
// full local calendar day, regardless of the server's own timezone.
export function endOfDayExclusiveInTimezone(dateString: string, timeZone: string): Date {
  const [year, month, day] = dateString.split("-").map(Number);
  const naiveUtcGuess = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));
  const offsetMinutes = timezoneOffsetMinutesAt(naiveUtcGuess, timeZone);
  return new Date(naiveUtcGuess.getTime() - offsetMinutes * 60_000);
}

function addDaysToDateString(dateString: string, days: number): string {
  const [year, month, day] = dateString.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export type DateRangePreset = "today" | "this_week" | "this_month" | "last_month";

export interface ResolvedDateRange {
  fromDateString: string;
  toDateString: string;
}

// Resolves a named quick-range preset into concrete "YYYY-MM-DD" bounds,
// evaluated against "today" AS SEEN IN THE STORE'S OWN TIMEZONE — never the
// server process's local date. Week starts Monday (the convention this
// admin's other date-ish displays already use, es-AR locale). "Mes
// anterior" is the FULL previous calendar month (both endpoints already in
// the past); every other preset runs through today, never into the future.
export function resolveDatePreset(preset: DateRangePreset, now: Date, timeZone: string): ResolvedDateRange {
  const todayString = formatDateInTimezone(now, timeZone);
  const [year, month, day] = todayString.split("-").map(Number);

  switch (preset) {
    case "today":
      return { fromDateString: todayString, toDateString: todayString };
    case "this_week": {
      // JS getUTCDay(): 0=Sunday..6=Saturday. Days since the most recent
      // Monday (Monday itself -> 0).
      const asUtcDate = new Date(Date.UTC(year, month - 1, day));
      const dayOfWeek = asUtcDate.getUTCDay();
      const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      return { fromDateString: addDaysToDateString(todayString, -daysSinceMonday), toDateString: todayString };
    }
    case "this_month": {
      const firstOfMonth = `${year}-${String(month).padStart(2, "0")}-01`;
      return { fromDateString: firstOfMonth, toDateString: todayString };
    }
    case "last_month": {
      const lastMonthYear = month === 1 ? year - 1 : year;
      const lastMonth = month === 1 ? 12 : month - 1;
      const firstOfLastMonth = `${lastMonthYear}-${String(lastMonth).padStart(2, "0")}-01`;
      // Day 0 of "this" month == last day of the previous month.
      const lastDayOfLastMonth = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
      const lastOfLastMonth = `${lastMonthYear}-${String(lastMonth).padStart(2, "0")}-${String(lastDayOfLastMonth).padStart(2, "0")}`;
      return { fromDateString: firstOfLastMonth, toDateString: lastOfLastMonth };
    }
  }
}
