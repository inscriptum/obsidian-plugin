import { describe, it, expect } from "vitest";
import { safeColorValue } from "./safeStyle";
import { bordersToStyle } from "./borders";

describe("safeColorValue (inline-style injection guard)", () => {
  it("accepts UI-shaped colors: hex and numeric rgb/rgba", () => {
    expect(safeColorValue("#b3a3f7")).toBe("#b3a3f7");
    expect(safeColorValue("#abc")).toBe("#abc");
    expect(safeColorValue("rgba(179, 163, 247, .16)")).toBe(
      "rgba(179, 163, 247, .16)",
    );
    expect(safeColorValue("rgb(96, 165, 250)")).toBe("rgb(96, 165, 250)");
  });

  it("rejects values that could inject CSS declarations", () => {
    const injection = "red; background-image: url(https://attacker.example/p)";
    expect(safeColorValue(injection)).toBeNull();
    expect(safeColorValue("red url(https://x.example/p)")).toBeNull();
    expect(safeColorValue("expression(alert(1))")).toBeNull();
    expect(safeColorValue("#b3a3f7; color: red")).toBeNull();
    expect(safeColorValue("")).toBeNull();
  });
});

describe("bordersToStyle injection guard", () => {
  it("renders well-formed sides", () => {
    expect(
      bordersToStyle({
        top: { style: "solid", width: "1.5pt", color: "#b3a3f7" },
      }),
    ).toBe("border-top: 1.5pt solid #b3a3f7 !important");
  });

  it("skips sides with malformed values instead of interpolating them", () => {
    expect(
      bordersToStyle({
        top: {
          style: "solid",
          width: "1pt; background-image: url(https://x.example/p)",
          color: "#ffffff",
        } as never,
        bottom: { style: "solid; } td { display: none", width: "1pt" } as never,
        right: { style: "solid", width: "1.5pt", color: "#b3a3f7" },
      }),
    ).toBe("border-right: 1.5pt solid #b3a3f7 !important");
  });

  it("keeps the theme-default color and rejects crafted colors", () => {
    expect(
      bordersToStyle({
        left: { style: "dashed", width: "1pt", color: null },
      }),
    ).toBe("border-left: 1pt dashed var(--inscriptum-table-border) !important");
    expect(
      bordersToStyle({
        left: {
          style: "dashed",
          width: "1pt",
          color: "var(--x); background: url(https://x.example)",
        } as never,
      }),
    ).toBe("");
  });
});
