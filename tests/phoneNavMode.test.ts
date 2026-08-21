import { describe, it, expect } from "vitest";
import {
  nextPhoneNavMode,
  parsePhoneNavMode,
  DEFAULT_PHONE_NAV_MODE,
  NAV_MODE_STORAGE_KEY,
} from "../src/components/toolbar/phoneNavMode";

describe("phoneNavMode pure logic", () => {
  it("toggles between our and native", () => {
    expect(nextPhoneNavMode("our")).toBe("native");
    expect(nextPhoneNavMode("native")).toBe("our");
    expect(nextPhoneNavMode(nextPhoneNavMode("our"))).toBe("our");
  });

  it("parses a stored value into a valid mode", () => {
    expect(parsePhoneNavMode("native")).toBe("native");
    expect(parsePhoneNavMode("our")).toBe("our");
  });

  it("falls back to the default for unknown/null/empty values", () => {
    expect(parsePhoneNavMode(null)).toBe(DEFAULT_PHONE_NAV_MODE);
    expect(parsePhoneNavMode(undefined)).toBe(DEFAULT_PHONE_NAV_MODE);
    expect(parsePhoneNavMode("")).toBe(DEFAULT_PHONE_NAV_MODE);
    expect(parsePhoneNavMode("garbage")).toBe(DEFAULT_PHONE_NAV_MODE);
  });

  it("exposes a stable storage key", () => {
    expect(NAV_MODE_STORAGE_KEY).toBe("inscriptum.phoneNavMode");
  });
});
