import { annotateArea } from "./area.js";
import { annotateDatesAgo } from "./datesAgo.js";
import { annotateDurations } from "./durations.js";

/** Every conversion that needs only the customer's question and today's date. */
export function annotateQuestion(text: string, today: string): string {
  return annotateDatesAgo(annotateArea(annotateDurations(text)), today);
}
