import { describe, it, expect } from "vitest";
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

  it("falls through to a unique suffix when the numeric range is exhausted", () => {
    const name = nextFreeNotepadName(
      () => true,
      "Notepad",
      3,
    );
    expect(name.startsWith("Notepad ")).toBe(true);
    expect(name).not.toBe("Notepad");
    expect(name).not.toBe("Notepad 1");
    expect(name).not.toBe("Notepad 2");
    expect(name).not.toBe("Notepad 3");
  });
});
