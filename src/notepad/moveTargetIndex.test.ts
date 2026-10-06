import { describe, it, expect } from "vitest";
import { moveTargetIndex } from "./moveTargetIndex";

const pages = (ids: string[]) => ids.map((id) => ({ id }));

describe("moveTargetIndex", () => {
  const notes = pages(["T", "A", "B", "C"]);

  it("inserts right after the tapped page when moving upward", () => {
    // move A above B: remove A first → [T,B,C], insert@2 → [T,B,A,C]
    expect(moveTargetIndex(notes, "A", "B")).toBe(2);
    expect(moveTargetIndex(notes, "A", "C")).toBe(3);
  });

  it("accounts for the removal shift when moving downward", () => {
    // move C above A: remove C first → [T,A,B], insert@2 → [T,A,C,B]
    expect(moveTargetIndex(notes, "C", "A")).toBe(2);
    expect(moveTargetIndex(notes, "B", "A")).toBe(2);
  });

  it("moves right after the title page to the top of the page list", () => {
    expect(moveTargetIndex(notes, "A", "T")).toBe(1);
    expect(moveTargetIndex(notes, "C", "T")).toBe(1);
  });

  it("handles adjacent and self-neighbor taps", () => {
    // B → after C (its current next): lands back where it was relative to C
    expect(moveTargetIndex(notes, "B", "C")).toBe(3);
    // A → after T (its current prev): net no-op
    expect(moveTargetIndex(notes, "A", "T")).toBe(1);
  });

  it("returns null for unknown ids", () => {
    expect(moveTargetIndex(notes, "X", "A")).toBeNull();
    expect(moveTargetIndex(notes, "A", "X")).toBeNull();
  });
});
