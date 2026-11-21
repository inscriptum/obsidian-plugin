import { describe, it, expect } from "vitest";
import { navbarClearanceValue } from "../src/tools/navbarClearance";

describe("navbarClearanceValue", () => {
  it("returns null when the navbar is absent", () => {
    expect(navbarClearanceValue(800, null, true, 34)).toBeNull();
  });

  it("returns null when the navbar is not raised", () => {
    expect(navbarClearanceValue(800, 700, false, 0)).toBeNull();
  });

  it("measures the window distance below the navbar plus the gap", () => {
    // navbar top at 736 in an 800px window: 800 - 736 + 8 = 72
    expect(navbarClearanceValue(800, 736, true, 0)).toBe(72);
  });

  it("covers an Android system bar that shifts the navbar up", () => {
    // 3-button nav: the floating navbar sits higher in the same window
    expect(navbarClearanceValue(800, 660, true, 0)).toBe(148);
  });

  it("never reserves less than the safe-area inset", () => {
    // a raised-but-hidden navbar is transformed below the window
    expect(navbarClearanceValue(800, 900, true, 34)).toBe(34);
  });

  it("does not double-count the inset on iOS", () => {
    // the floating navbar's own offset already includes the inset region
    // (top at 710): clearance is measured from its box, inset is the floor
    expect(navbarClearanceValue(800, 710, true, 34)).toBe(98);
  });
});
