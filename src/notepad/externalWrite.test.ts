import { describe, expect, it } from "vitest";
import { resolveExternalWrite } from "./externalWrite";

describe("resolveExternalWrite", () => {
  const base = {
    diskFingerprint: "100:10",
    savedFingerprint: "100:10",
    conflictModalOpen: false,
    bypassExternalCheck: false,
  };

  it("writes when the disk matches the last reflected state (own autosave)", () => {
    expect(resolveExternalWrite(base)).toEqual({ action: "write" });
  });

  it("opens the modal on an unobserved external change", () => {
    expect(
      resolveExternalWrite({ ...base, diskFingerprint: "200:12" }),
    ).toEqual({ action: "modal" });
  });

  it("blocks instead of stacking a second dialog while one is open", () => {
    expect(
      resolveExternalWrite({
        ...base,
        diskFingerprint: "200:12",
        conflictModalOpen: true,
      }),
    ).toEqual({ action: "block" });
  });

  it("writes through after the user chose keep-local", () => {
    expect(
      resolveExternalWrite({
        ...base,
        diskFingerprint: "200:12",
        bypassExternalCheck: true,
      }),
    ).toEqual({ action: "write" });
  });

  it("bypass wins even while a conflict dialog is open", () => {
    expect(
      resolveExternalWrite({
        ...base,
        diskFingerprint: "200:12",
        conflictModalOpen: true,
        bypassExternalCheck: true,
      }),
    ).toEqual({ action: "write" });
  });

  it("writes when the file is gone, even with a dialog open", () => {
    expect(
      resolveExternalWrite({
        ...base,
        diskFingerprint: null,
        conflictModalOpen: true,
      }),
    ).toEqual({ action: "write" });
  });

  it("never blocks saving when the disk state is unknown (stat failed)", () => {
    expect(
      resolveExternalWrite({ ...base, diskFingerprint: null }),
    ).toEqual({ action: "write" });
  });

  it("treats an unknown saved fingerprint as an external change", () => {
    expect(
      resolveExternalWrite({ ...base, savedFingerprint: null }),
    ).toEqual({ action: "modal" });
  });
});
