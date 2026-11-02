import type { ValidityWindow } from "../types.js";

export type SaleStatus = "active" | "upcoming" | "expired";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAY = String.raw`(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s+)?`;
const DATE = String.raw`${WEEKDAY}([a-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?`;
const VALIDITY_PATTERN = new RegExp(
  String.raw`valid\s+(?:from\s+)?${DATE}\s+(?:through|thru|to|until|-|–)\s+${DATE}`,
  "i",
);

/**
 * Finds "Valid Friday, October 9 through Monday, October 12, 2026" in a document.
 * The front matter only says when a flyer was published; the sale window is in the text.
 * A missing year falls back to the document's effective year.
 */
export function parseValidityWindow(text: string, effective: string): ValidityWindow | undefined {
  const match = VALIDITY_PATTERN.exec(text.replace(/\*/g, ""));
  if (!match) return undefined;

  const [, startMonth, startDay, startYear, endMonth, endDay, endYear] = match;
  const fallbackYear = Number(endYear ?? startYear ?? effective.slice(0, 4));
  if (!fallbackYear) return undefined;

  const validFrom = toIsoDate(startMonth, startDay, Number(startYear ?? fallbackYear));
  let validTo = toIsoDate(endMonth, endDay, fallbackYear);
  if (!validFrom || !validTo) return undefined;
  if (validTo < validFrom && !endYear) validTo = toIsoDate(endMonth, endDay, fallbackYear + 1)!; // "Dec 28 to Jan 3"

  return { validFrom, validTo };
}

/** Both ends are inclusive. Dates are YYYY-MM-DD strings, which compare correctly as text. */
export function saleStatus(window: ValidityWindow, today: string): SaleStatus {
  if (today < window.validFrom) return "upcoming";
  if (today > window.validTo) return "expired";
  return "active";
}

function toIsoDate(monthName: string, day: string, year: number): string | undefined {
  const month = MONTHS.indexOf(monthName.slice(0, 3).toLowerCase());
  const dayNumber = Number(day);
  if (month < 0 || dayNumber < 1 || dayNumber > 31) return undefined;
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`;
}
