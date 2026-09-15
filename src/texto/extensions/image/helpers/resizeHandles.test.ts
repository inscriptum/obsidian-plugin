import { describe, it, expect } from "vitest";
import { computeResizePercent } from "./resizeHandles";

describe("computeResizePercent", () => {
  const base = { startWidth: 320, contentWidth: 640 };

  it("grows when dragging the right handle outwards", () => {
    expect(computeResizePercent({ ...base, dx: 64, side: "right" })).toBe(60);
  });

  it("shrinks when dragging the right handle inwards", () => {
    expect(computeResizePercent({ ...base, dx: -64, side: "right" })).toBe(40);
  });

  it("mirrors the delta for the left handle", () => {
    expect(computeResizePercent({ ...base, dx: -64, side: "left" })).toBe(60);
    expect(computeResizePercent({ ...base, dx: 64, side: "left" })).toBe(40);
  });

  it("clamps to a minimum of 80px", () => {
    // 320 - 300 = 20px < 80px -> clamps to 80px = 12.5% -> 13 (rounded)
    expect(computeResizePercent({ ...base, dx: -300, side: "right" })).toBe(13);
  });

  it("clamps to 100% maximum", () => {
    expect(computeResizePercent({ ...base, dx: 1000, side: "right" })).toBe(
      100,
    );
  });

  it("rounds to whole percents", () => {
    // (320 + 30) / 640 = 54.68% -> 55
    expect(computeResizePercent({ ...base, dx: 30, side: "right" })).toBe(55);
  });

  it("returns the minimum for a degenerate content width", () => {
    expect(
      computeResizePercent({
        startWidth: 320,
        dx: 10,
        side: "right",
        contentWidth: 0,
      }),
    ).toBe(5);
  });
});
