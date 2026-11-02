const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const DAYS_PER_UNIT: Record<string, number> = { week: 7, month: 30, year: 365 };
const DURATION_PATTERN = new RegExp(
  String.raw`\b(\d+|${Object.keys(NUMBER_WORDS).join("|")})\s+(week|month|year)s?\b(?!\s*\()`,
  "gi",
);

/**
 * "5 weeks" -> "5 weeks (35 days)", so the model compares a customer's timeline
 * against day-based limits ("returnable within 30 days") without doing the conversion.
 */
export function annotateDurations(text: string): string {
  return text.replace(DURATION_PATTERN, (match, amount: string, unit: string) => {
    const count = /^\d+$/.test(amount) ? Number(amount) : NUMBER_WORDS[amount.toLowerCase()];
    const lowerUnit = unit.toLowerCase();
    const days = count * DAYS_PER_UNIT[lowerUnit];
    return `${match} (${lowerUnit === "week" ? "" : "about "}${days} days)`;
  });
}
