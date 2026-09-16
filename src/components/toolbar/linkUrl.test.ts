import { describe, it, expect } from "vitest";
import { normalizeLinkUrl } from "./linkUrl";

describe("normalizeLinkUrl", () => {
  it("empty input yields empty string", () => {
    expect(normalizeLinkUrl("")).toBe("");
    expect(normalizeLinkUrl("   ")).toBe("");
  });

  it("trims whitespace", () => {
    expect(normalizeLinkUrl("  https://example.com  ")).toBe(
      "https://example.com",
    );
  });

  it("defaults a bare domain to https", () => {
    expect(normalizeLinkUrl("example.com")).toBe("https://example.com");
    expect(normalizeLinkUrl("example.com/path?q=1")).toBe(
      "https://example.com/path?q=1",
    );
  });

  it("keeps existing schemes", () => {
    expect(normalizeLinkUrl("http://example.com")).toBe("http://example.com");
    expect(normalizeLinkUrl("mailto:user@example.com")).toBe(
      "mailto:user@example.com",
    );
    expect(normalizeLinkUrl("obsidian://open/vault/note")).toBe(
      "obsidian://open/vault/note",
    );
  });
});
