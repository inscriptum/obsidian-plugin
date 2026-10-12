import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  openImageLightbox,
  openImageLightboxFromUrl,
  openSvgLightbox,
  closeImageLightbox,
} from "./imageLightbox";

const LIGHTBOX_CLASS = "inscriptum-image-lightbox";
const SVG_NS = "http://www.w3.org/2000/svg";

function makeApp(existing: string[], srcFor?: (id: string) => string) {
  return {
    vault: {
      getAbstractFileByPath: (path: string) =>
        existing.includes(path) ? { path } : null,
      adapter: {
        getResourcePath: srcFor ?? ((id: string) => `app://test/${id}`),
      },
    },
  } as never;
}

function makeSvg(attrs: Record<string, string> = {}): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [key, value] of Object.entries(attrs)) {
    svg.setAttribute(key, value);
  }
  return svg;
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
    expect(
      overlay?.querySelector(`.${LIGHTBOX_CLASS}__caption`)?.textContent,
    ).toBe("img.png");
  });

  it("does nothing when the file is missing", () => {
    openImageLightbox(makeApp([]), "gone.png");
    expect(document.querySelector(`.${LIGHTBOX_CLASS}`)).toBeNull();
  });

  it("closes on a background click and removes the overlay", () => {
    openImageLightbox(makeApp(["img.png"]), "img.png");
    const overlay = document.querySelector(`.${LIGHTBOX_CLASS}`) as HTMLElement;
    overlay.click();
    expect(document.querySelector(`.${LIGHTBOX_CLASS}`)).toBeNull();
  });

  it("does not close when the image itself is clicked", () => {
    openImageLightbox(makeApp(["img.png"]), "img.png");
    const overlay = document.querySelector(`.${LIGHTBOX_CLASS}`) as HTMLElement;
    const img = overlay.querySelector("img");
    img?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(`.${LIGHTBOX_CLASS}`)).not.toBeNull();
  });

  it("closes via the close button", () => {
    openImageLightbox(makeApp(["img.png"]), "img.png");
    const overlay = document.querySelector(`.${LIGHTBOX_CLASS}`) as HTMLElement;
    const btn = overlay.querySelector(
      `.${LIGHTBOX_CLASS}__close`,
    ) as HTMLButtonElement;
    expect(btn).not.toBeNull();
    btn.click();
    expect(document.querySelector(`.${LIGHTBOX_CLASS}`)).toBeNull();
  });

  it("closes on Escape with capture-phase keydown", () => {
    openImageLightbox(makeApp(["img.png"]), "img.png");
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(document.querySelector(`.${LIGHTBOX_CLASS}`)).toBeNull();
  });

  it("replaces an already open lightbox instead of stacking", () => {
    openImageLightbox(makeApp(["a.png"]), "a.png");
    openImageLightbox(makeApp(["b.png"]), "b.png");
    const overlays = document.querySelectorAll(`.${LIGHTBOX_CLASS}`);
    expect(overlays.length).toBe(1);
    expect(overlays[0].querySelector("img")?.getAttribute("src")).toBe(
      "app://test/b.png",
    );
  });

  it("stops listening for Escape after close", () => {
    openImageLightbox(makeApp(["img.png"]), "img.png");
    (document.querySelector(`.${LIGHTBOX_CLASS}`) as HTMLElement).click();
    // re-dispatch Escape: no overlay must reappear or throw
    expect(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    ).not.toThrow();
    expect(document.querySelector(`.${LIGHTBOX_CLASS}`)).toBeNull();
  });
});

describe("openSvgLightbox", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    closeImageLightbox();
  });

  it("clones the svg at its viewBox size without the inline style", () => {
    const svg = makeSvg({
      viewBox: "0 0 400 300",
      style: "max-width: 320px;",
    });
    document.body.appendChild(svg);

    openSvgLightbox(svg);

    const overlay = document.querySelector(`.${LIGHTBOX_CLASS}`);
    expect(overlay).not.toBeNull();
    const clone = overlay?.querySelector("svg");
    expect(clone).not.toBeNull();
    expect(clone).not.toBe(svg);
    expect(clone?.getAttribute("width")).toBe("400");
    expect(clone?.getAttribute("height")).toBe("300");
    expect(clone?.getAttribute("viewBox")).toBe("0 0 400 300");
    expect(clone?.getAttribute("style")).toBeNull();
    // the source node stays in place
    expect(svg.isConnected).toBe(true);
  });

  it("opens without a caption (diagram lightbox is captionless)", () => {
    openSvgLightbox(makeSvg({ viewBox: "0 0 10 10" }));
    const overlay = document.querySelector(`.${LIGHTBOX_CLASS}`);
    expect(
      overlay?.querySelector(`.${LIGHTBOX_CLASS}__caption`),
    ).toBeNull();
  });

  it("keeps the source attributes when no usable viewBox is present", () => {
    const svg = makeSvg({ width: "120", height: "80" });
    openSvgLightbox(svg);
    const clone = document
      .querySelector(`.${LIGHTBOX_CLASS}`)
      ?.querySelector("svg");
    expect(clone?.getAttribute("width")).toBe("120");
    expect(clone?.getAttribute("height")).toBe("80");
  });

  it("closes on Escape like the image lightbox", () => {
    openSvgLightbox(makeSvg({ viewBox: "0 0 10 10" }));
    expect(document.querySelector(`.${LIGHTBOX_CLASS}`)).not.toBeNull();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(document.querySelector(`.${LIGHTBOX_CLASS}`)).toBeNull();
  });
});

describe("url lightbox", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    closeImageLightbox();
  });

  it("openImageLightboxFromUrl keeps the caption behavior", () => {
    openImageLightboxFromUrl("blob:asset-1", "chart.png");
    const overlay = document.querySelector(`.${LIGHTBOX_CLASS}`);
    expect(overlay?.querySelector("img")?.getAttribute("src")).toBe(
      "blob:asset-1",
    );
    expect(
      overlay?.querySelector(`.${LIGHTBOX_CLASS}__caption`)?.textContent,
    ).toBe("chart.png");
  });
});
