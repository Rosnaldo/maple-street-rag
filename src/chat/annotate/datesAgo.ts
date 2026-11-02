const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DATE_PATTERN = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?(?!\s*\()/gi;
const YEAR_PATTERN = /\b(in|from|since)\s+((?:19|20)\d{2})\b(?!\s*\()/gi;
const DAY_MS = 86_400_000;

/**
 * "on October 3" -> "on October 3 (29 days ago)" and "made in 2012" -> "made in 2012 (14 years ago)".
 * Only past dates: a date without a year that is still ahead this year could mean either year.
 */
export function annotateDatesAgo(text: string, today: string): string {
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const currentYear = Number(today.slice(0, 4));
  return text
    .replace(DATE_PATTERN, (match, month: string, day: string, year?: string) => {
      const monthIndex = MONTHS.indexOf(month.slice(0, 3).toLowerCase());
      const dateMs = Date.UTC(Number(year ?? currentYear), monthIndex, Number(day));
      const days = Math.round((todayMs - dateMs) / DAY_MS);
      if (days < 0 || new Date(dateMs).getUTCDate() !== Number(day)) return match;
      return `${match} (${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`})`;
    })
    .replace(YEAR_PATTERN, (match, _word: string, year: string) => {
      const years = currentYear - Number(year);
      return years > 0 ? `${match} (${years} year${years === 1 ? "" : "s"} ago)` : match;
    });
}
