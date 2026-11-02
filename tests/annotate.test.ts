// Conversions added to customer questions (src/chat/annotate). Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { annotateArea } from "../src/chat/annotate/area.js";
import { annotateDatesAgo } from "../src/chat/annotate/datesAgo.js";
import { annotateDurations } from "../src/chat/annotate/durations.js";

describe("annotateDurations", () => {
  it("adds the number of days to weeks, months and years", () => {
    assert.equal(annotateDurations("I opened my drill 5 weeks ago."), "I opened my drill 5 weeks (35 days) ago.");
    assert.equal(annotateDurations("Bought it two months ago"), "Bought it two months (about 60 days) ago");
    assert.equal(annotateDurations("a year ago"), "a year (about 365 days) ago");
  });

  it("leaves other text alone", () => {
    assert.equal(annotateDurations("I bought it 10 days ago."), "I bought it 10 days ago.");
  });
});

describe("annotateArea", () => {
  it("adds square inches and square feet", () => {
    assert.equal(annotateArea("glass 24 by 18 inches?"), "glass 24 by 18 inches (432 sq in = 3 sq ft)?");
    assert.equal(annotateArea('a 10" x 12" piece'), 'a 10" x 12" (120 sq in = 0.83 sq ft) piece');
  });
});

describe("annotateDatesAgo", () => {
  it("adds days since a past date and years since a past year", () => {
    assert.equal(annotateDatesAgo("I bought it on October 3.", "2026-11-01"), "I bought it on October 3 (29 days ago).");
    assert.equal(annotateDatesAgo("made in 2012", "2026-10-28"), "made in 2012 (14 years ago)");
  });

  it("leaves future dates alone", () => {
    assert.equal(annotateDatesAgo("Are you open December 24?", "2026-11-01"), "Are you open December 24?");
  });
});
