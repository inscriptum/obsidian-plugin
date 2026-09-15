import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openImageLightbox, closeImageLightbox } from "./imageLightbox";

const LIGHTBOX_CLASS = "inscriptum-image-lightbox";

function makeApp(existing: string[], srcFor?: (id: string) => string) {
  return {
    vault: {
      getAbstractFileByPath: (path: string) =>
        existing.includes(path) ? { path } : null,
      adapter: { getResourcePath: srcFor ?? ((id: string) => `app://test/${id}`) },
    },
  } as never;
}

describe("openImageLightbox", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    closeImageLightbox();
  });

  it("appends an overlay with the image when the file exists", () => {
    openImageLightbox(makeApp(["img.png"]), "img.png", "img.png");
    const overlay = document.querySelector(`.${LIGHTBOX_CLASS}`);
    expect(overlay).not.toBeNull();
    const img = overlay?.querySelector("img");
    expect(img?.getAttribute("src")).toBe("app://test/img.png");
    expect(overlay?.querySelector(`.${LIGHTBOX_CLASS}__caption`)?.textContent).toBe("img.png");
  });

  it("does nothing when the file is missing", () => {
    openImageLightbox(makeApp([]), "gone.png");
    expect(document.querySelector(`.${LIGHTBOX_CLASS}`)).toBeNull();
  });

  it("closes on click and removes the overlay", () => {
    openImageLightbox(makeApp(["img.png"]), "img.png");
    const overlay = document.querySelector(`.${LIGHTBOX_CLASS}`) as HTMLElement;
    overlay.click();
    expect(document.querySelector(`.${LIGHTBOX_CLASS}`)).toBeNull();
  });

  it("closes on Escape with capture-phase keydown", () => {
    openImageLightbox(makeApp(["img.png"]), "img.png");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(`.${LIGHTBOX_CLASS}`)).toBeNull();
  });

  it("replaces an already open lightbox instead of stacking", () => {
    openImageLightbox(makeApp(["a.png"]), "a.png");
    openImageLightbox(makeApp(["b.png"]), "b.png");
    const overlays = document.querySelectorAll(`.${LIGHTBOX_CLASS}`);
    expect(overlays.length).toBe(1);
    expect(overlays[0].querySelector("img")?.getAttribute("src")).toBe("app://test/b.png");
  });

  it("stops listening for Escape after close", () => {
    openImageLightbox(makeApp(["img.png"]), "img.png");
    (document.querySelector(`.${LIGHTBOX_CLASS}`) as HTMLElement).click();
    // re-dispatch Escape: no overlay must reappear or throw
    expect(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    ).not.toThrow();
    expect(document.querySelector(`.${LIGHTBOX_CLASS}`)).toBeNull();
  });
});
