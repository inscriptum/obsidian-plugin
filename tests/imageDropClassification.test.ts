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

  it("rejects Chromium image MIME the renderer cannot decode (with or without an extension)", () => {
    expect(isImageDropFile(file("a.heic", "image/heic"), ACCEPT)).toBe(false);
    expect(isImageDropFile(file("b.heif", "image/heif"), ACCEPT)).toBe(false);
    expect(isImageDropFile(file("c.tiff", "image/tiff"), ACCEPT)).toBe(false);
    // extension-less: must be blacklisted by MIME alone
    expect(isImageDropFile(file("photo", "image/heic"), ACCEPT)).toBe(false);
  });

  it("keeps extension-less image files on the MIME path", () => {
    expect(isImageDropFile(file("photo", "image/png"), ACCEPT)).toBe(true);
  });

  it("rejects image-MIME files whose name extension is not renderable", () => {
    // An image/* MIME with a non-image file extension goes to the
    // attachment path (the renderer cannot display it) — this is the
    // extension barrier under the MIME branch, not the UNRENDERABLE_MIME
    // blacklist above it.
    expect(isImageDropFile(file("photo.doc", "image/png"), ACCEPT)).toBe(
      false,
    );
    // uppercase extension: lowercased before the check, still rejected
    expect(isImageDropFile(file("PHOTO.DOC", "image/png"), ACCEPT)).toBe(
      false,
    );
    // uppercase valid extension keeps the MIME path
    expect(isImageDropFile(file("photo.PNG", "image/png"), ACCEPT)).toBe(true);
  });

  it(".tiff with an empty MIME is rejected by the extension path", () => {
    expect(isImageDropFile(file("c.tiff", ""), ACCEPT)).toBe(false);
  });
});
