import { describe, it, expect } from "vitest";
import { computeScrollShadowState } from "../src/components/toolbar/scrollShadow";

describe("computeScrollShadowState", () => {
  it("reports no shadows when the content fits", () => {
    expect(computeScrollShadowState(0, 300, 300)).toEqual({
      canScrollLeft: false,
      canScrollRight: false,
    });
  });

  it("reports only a right shadow at the start of an overflowing row", () => {
    expect(computeScrollShadowState(0, 600, 300)).toEqual({
      canScrollLeft: false,
      canScrollRight: true,
    });
  });

  it("reports both shadows in the middle of the scroll range", () => {
    expect(computeScrollShadowState(150, 600, 300)).toEqual({
      canScrollLeft: true,
      canScrollRight: true,
    });
  });

  it("reports only a left shadow at the end of the scroll range", () => {
    expect(computeScrollShadowState(300, 600, 300)).toEqual({
      canScrollLeft: true,
      canScrollRight: false,
    });
  });

  it("tolerates a 1px rounding slop before flipping a shadow", () => {
    expect(computeScrollShadowState(1, 600, 300).canScrollLeft).toBe(false);
    expect(computeScrollShadowState(2, 600, 300).canScrollLeft).toBe(true);
    expect(computeScrollShadowState(299, 600, 300).canScrollRight).toBe(false);
    expect(computeScrollShadowState(298, 600, 300).canScrollRight).toBe(true);
  });
});
