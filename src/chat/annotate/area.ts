const AREA_PATTERN = /\b(\d+(?:\.\d+)?)\s*(?:"|in(?:ch(?:es)?)?\b)?\s*(?:by|x|×)\s*(\d+(?:\.\d+)?)\s*(?:"|in(?:ch(?:es)?)?\b)(?!\s*\()/gi;

/** "24 by 18 inches" -> "24 by 18 inches (432 sq in = 3 sq ft)", for prices quoted per square foot. */
export function annotateArea(text: string): string {
  return text.replace(AREA_PATTERN, (match, width: string, height: string) => {
    const squareInches = Number(width) * Number(height);
    return `${match} (${round2(squareInches)} sq in = ${round2(squareInches / 144)} sq ft)`;
  });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
