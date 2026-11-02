const FIXED_HOLIDAYS: Record<string, string> = {
  "1-1": "New Year's Day",
  "2-14": "Valentine's Day",
  "7-4": "Independence Day",
  "10-31": "Halloween",
  "12-24": "Christmas Eve",
  "12-25": "Christmas Day",
  "12-31": "New Year's Eve",
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DATE_PATTERN = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})\b(?!\d)( \()?/gi;

/**
 * "December 24" -> "December 24 (Christmas Eve)", so a question that names the
 * holiday matches a document that only gives the date, in retrieval and for the model.
 */
export function annotateHolidays(text: string): string {
  return text.replace(DATE_PATTERN, (match, month: string, day: string, openParen?: string) => {
    if (openParen) return match; // already annotated, e.g. "July 4 (Independence Day)"
    const holiday = FIXED_HOLIDAYS[`${MONTHS.indexOf(month.slice(0, 3).toLowerCase()) + 1}-${Number(day)}`];
    return holiday && !text.includes(holiday) ? `${match} (${holiday})` : match;
  });
}
