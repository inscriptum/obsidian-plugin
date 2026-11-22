import { describe, it, expect, afterEach, vi } from "vitest";
import { nextFreeNotepadName } from "../src/storage/fileNaming";

describe("nextFreeNotepadName", () => {
  it("returns the base name when the vault has no Notepad.um", () => {
    expect(nextFreeNotepadName(() => false)).toBe("Notepad");
  });

  it("walks to the first free numbered name", () => {
    const taken = new Set(["Notepad", "Notepad 1", "Notepad 2"]);
    expect(nextFreeNotepadName((n) => taken.has(n))).toBe("Notepad 3");
  });

  it("skips only the taken names, leaving gaps behind", () => {
    const taken = new Set(["Notepad", "Notepad 2"]);
    expect(nextFreeNotepadName((n) => taken.has(n))).toBe("Notepad 1");
  });

  describe("timestamp fallback (pinned clock)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function pinClock(): string {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-22T12:00:00Z"));
      return Date.now().toString(36);
    }

    it("returns the free timestamp candidate when the numeric range is exhausted", () => {
      const stamp = pinClock();
      const name = nextFreeNotepadName(
        (n) => n === "Notepad" || /^Notepad \d+$/.test(n),
        "Notepad",
        3,
      );
      expect(name).toBe(`Notepad ${stamp}`);
    });

    it("walks the suffix when even the first timestamp candidate is taken", () => {
      const stamp = pinClock();
      const taken = new Set([
        "Notepad",
        "Notepad 1",
        "Notepad 2",
        "Notepad 3",
        `Notepad ${stamp}`,
      ]);
      const name = nextFreeNotepadName((n) => taken.has(n), "Notepad", 3);
      expect(name).toBe(`Notepad ${stamp}-1`);
    });

    it("keeps walking suffixes while every candidate is taken", () => {
      const stamp = pinClock();
      const taken = new Set([
        "Notepad",
        `Notepad ${stamp}`,
        `Notepad ${stamp}-1`,
        `Notepad ${stamp}-2`,
      ]);
      const name = nextFreeNotepadName((n) => taken.has(n), "Notepad", 0);
      expect(name).toBe(`Notepad ${stamp}-3`);
    });
  });
});
