import { describe, it, expect } from "vitest";
import { isImageDropFile } from "../src/texto/extensions/image/image";

const ACCEPT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

function file(name: string, type: string): File {
  return new File([new Uint8Array(8)], name, { type });
}

describe("isImageDropFile", () => {
  it("classifies by MIME type", () => {
    expect(isImageDropFile(file("a.png", "image/png"), ACCEPT)).toBe(true);
    expect(isImageDropFile(file("b.txt", "text/plain"), ACCEPT)).toBe(false);
    expect(isImageDropFile(file("c.pdf", "application/pdf"), ACCEPT)).toBe(
      false,
    );
  });

  it("classifies empty-MIME files by the accept-list extension", () => {
    expect(isImageDropFile(file("a.jpg", ""), ACCEPT)).toBe(true);
    expect(isImageDropFile(file("B.WEBP", ""), ACCEPT)).toBe(true);
    expect(isImageDropFile(file("c.txt", ""), ACCEPT)).toBe(false);
    expect(isImageDropFile(file("d.pdf", ""), ACCEPT)).toBe(false);
  });

  it("does not classify non-empty non-image MIME by extension", () => {
    expect(isImageDropFile(file("a.png", "application/octet-stream"), ACCEPT)).toBe(false);
  });
});
