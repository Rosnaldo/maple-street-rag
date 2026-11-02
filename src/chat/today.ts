const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** True for a real calendar date in YYYY-MM-DD form ("2026-02-30" is rejected). */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** The request's date, or the store's local date (not UTC, which rolls over at 7-8 PM Eastern). */
export function resolveToday(requested: string | undefined, timeZone: string, now = new Date()): string {
  return requested ?? now.toLocaleDateString("en-CA", { timeZone });
}

export function weekdayOf(isoDate: string): string {
  return WEEKDAYS[new Date(`${isoDate}T00:00:00Z`).getUTCDay()];
}
