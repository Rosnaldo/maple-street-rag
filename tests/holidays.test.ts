// Holiday names added next to fixed dates. Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { annotateHolidays } from "../src/ingest/annotate/holidays.js";

describe("annotateHolidays", () => {
  it("names the holiday next to its date", () => {
    assert.equal(
      annotateHolidays("December 24 and December 31: we close early, at 3:00 PM."),
      "December 24 (Christmas Eve) and December 31 (New Year's Eve): we close early, at 3:00 PM.",
    );
  });

  it("leaves other dates and already-named holidays alone", () => {
    assert.equal(annotateHolidays("Sale ends October 12."), "Sale ends October 12.");
    assert.equal(annotateHolidays("Christmas Eve, December 24: open late."), "Christmas Eve, December 24: open late.");
  });
});
