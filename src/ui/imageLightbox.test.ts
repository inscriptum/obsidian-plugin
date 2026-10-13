import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  openImageLightbox,
  openImageGallery,
  openImageLightboxFromUrl,
  openSvgLightbox,
  closeImageLightbox,
  collectGalleryItems,
  zoomTransform,
  panTransform,
  pinchTransform,
  clampScale,
  identityTransform,
  MIN_SCALE,
  MAX_SCALE,
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

function makeDoc(
  images: { id?: string | null; filename?: string | null }[],
): {
  descendants(fn: (node: never) => boolean): void;
} {
  return {
    descendants(fn) {
      for (const image of images) {
        fn({
          type: { name: "image" },
          attrs: { data: image },
        } as never);
      }
    },
  };
}

describe("collectGalleryItems", () => {
  const resolve = (data: { id?: string | null }) =>
    data.id != null && data.id !== "gone.png" ? `app://test/${data.id}` : null;

  it("collects available images in document order", () => {
    const items = collectGalleryItems(
      makeDoc([{ id: "b.png" }, { id: "a.png" }]),
      resolve,
    );
    expect(items.map((i) => i.id)).toEqual(["b.png", "a.png"]);
    expect(items[0]).toEqual({
      id: "b.png",
      src: "app://test/b.png",
      filename: undefined,
    });
  });

  it("skips unavailable images and nodes without id", () => {
    const items = collectGalleryItems(
      makeDoc([{ id: "gone.png" }, { id: null }, { id: "ok.png" }]),
      resolve,
    );
    expect(items.map((i) => i.id)).toEqual(["ok.png"]);
  });

  it("deduplicates repeated references, keeping the first position", () => {
    const items = collectGalleryItems(
      makeDoc([{ id: "a.png" }, { id: "b.png" }, { id: "a.png", filename: "x" }]),
      resolve,
    );
    expect(items.map((i) => i.id)).toEqual(["a.png", "b.png"]);
  });

  it("returns an empty list for a null document", () => {
    expect(collectGalleryItems(null, resolve)).toEqual([]);
  });
});

describe("transform math", () => {
  it("clampScale bounds the scale into [MIN, MAX]", () => {
    expect(clampScale(0.5)).toBe(MIN_SCALE);
    expect(clampScale(4)).toBe(4);
    expect(clampScale(99)).toBe(MAX_SCALE);
  });

  it("zoomTransform keeps the content point under the focal pinned", () => {
    const t = identityTransform();
    const center = { x: 400, y: 300 };
    const focal = { x: 500, y: 350 };
    const z = zoomTransform(t, 2, focal, center);
    expect(z.scale).toBe(2);
    // content point p=(100, 50) under focal stays there:
    // focal = center + t' + scale'*p
    expect(focal.x).toBeCloseTo(center.x + z.x + 2 * 100);
    expect(focal.y).toBeCloseTo(center.y + z.y + 2 * 50);
  });

  it("zoomTransform is identity at the bounds", () => {
    const t = { scale: MIN_SCALE, x: 10, y: -4 };
    expect(zoomTransform(t, 0.5, { x: 0, y: 0 }, { x: 0, y: 0 })).toEqual(t);
    const maxed = { scale: MAX_SCALE, x: 0, y: 0 };
    expect(zoomTransform(maxed, 3, { x: 0, y: 0 }, { x: 0, y: 0 })).toEqual(
      maxed,
    );
  });

  it("zooming back down to fit snaps to the centered identity", () => {
    const zoomed = { scale: 2, x: 120, y: -60 };
    const fit = zoomTransform(zoomed, 0.5, { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(fit).toEqual(identityTransform());
  });

  it("panTransform clamps so the picture never fully leaves the screen", () => {
    const t = { scale: 4, x: 0, y: 0 };
    // a 100x100 image at scale 4, a 800x600 viewport: half-size 200;
    // limitX = 400 + 200 - 80 = 520; limitY = 600/2 + 200 - 80 = 420
    const p = panTransform(t, 10_000, -10_000, { width: 100, height: 100 }, {
      width: 800,
      height: 600,
    });
    expect(p.x).toBe(520);
    expect(p.y).toBe(-420);
    expect(p.scale).toBe(4);
  });

  it("pinchTransform keeps the picture under a translating two-finger drag", () => {
    // the Greptile scenario: zoom around the center, then move both fingers
    // 50px right at constant spacing — the picture must follow, not repel
    const start = { scale: 2, x: 0, y: 0 };
    const center = { x: 400, y: 300 };
    const t = pinchTransform(
      start,
      1,
      { x: 400, y: 300 },
      { x: 450, y: 300 },
      center,
      { width: 200, height: 100 },
      { width: 800, height: 600 },
    );
    expect(t.scale).toBe(2);
    expect(t.x).toBe(50);
    expect(t.y).toBe(0);
  });

  it("pinchTransform pins the starting content point under the moving midpoint", () => {
    const start = { scale: 1, x: 0, y: 0 };
    const center = { x: 400, y: 300 };
    // fingers 100px apart to the left of center; they double the distance
    // and drift 100px right: the content point grabbed at the start (-50, 0)
    // must land under the new midpoint (450, 300)
    const t = pinchTransform(
      start,
      2,
      { x: 350, y: 300 },
      { x: 450, y: 300 },
      center,
      { width: 400, height: 300 },
      { width: 800, height: 600 },
    );
    expect(t.scale).toBe(2);
    // 450 = 400 + t.x + 2 * (-50)
    expect(t.x).toBe(150);
    expect(t.y).toBe(0);
  });
});

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

  it("does not close on a double click over the image either", () => {
    openImageGallery(
      [{ id: "a.png", src: "app://test/a.png", filename: "a.png" }],
      0,
    );
    const overlay = document.querySelector(`.${LIGHTBOX_CLASS}`) as HTMLElement;
    overlay
      .querySelector("img")
      ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
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

  it("releases focus on open (the mobile keyboard must hide)", () => {
    const target = createEl("textarea");
    document.body.appendChild(target);
    target.focus();
    expect(document.activeElement).toBe(target);

    openImageLightbox(makeApp(["img.png"]), "img.png");
    expect(document.activeElement).not.toBe(target);
    expect(document.querySelector(`.${LIGHTBOX_CLASS}`)).not.toBeNull();
  });

  it("carries no mobile modifier on a non-mobile platform", () => {
    openImageLightbox(makeApp(["img.png"]), "img.png");
    const overlay = document.querySelector(`.${LIGHTBOX_CLASS}`);
    expect(overlay?.className).not.toContain(`${LIGHTBOX_CLASS}--mobile`);
  });
});

describe("openImageGallery", () => {
  const threeItems = [
    { id: "a", src: "app://test/a.png", filename: "a.png" },
    { id: "b", src: "app://test/b.png", filename: null },
    { id: "c", src: "app://test/c.png", filename: "c.png" },
  ];

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    closeImageLightbox();
  });

  it("shows the counter and the start index", () => {
    openImageGallery(threeItems, 1);
    const overlay = document.querySelector(`.${LIGHTBOX_CLASS}`) as HTMLElement;
    expect(
      overlay.querySelector(`.${LIGHTBOX_CLASS}__counter`)?.textContent,
    ).toBe("2 / 3");
    expect(overlay.querySelector("img")?.getAttribute("src")).toBe(
      "app://test/b.png",
    );
  });

  it("navigates next/prev with looping edges, resetting zoom and position", () => {
    openImageGallery(threeItems, 0);
    const overlay = document.querySelector(`.${LIGHTBOX_CLASS}`) as HTMLElement;
    const next = overlay.querySelector(
      `.${LIGHTBOX_CLASS}__next`,
    ) as HTMLButtonElement;
    const prev = overlay.querySelector(
      `.${LIGHTBOX_CLASS}__prev`,
    ) as HTMLButtonElement;
    const counter = overlay.querySelector(
      `.${LIGHTBOX_CLASS}__counter`,
    ) as HTMLElement;
    const img = overlay.querySelector("img") as HTMLImageElement;

    next.click();
    expect(counter.textContent).toBe("2 / 3");
    // simulate a zoomed state, then move on: transform must reset
    img.style.transform = `translate(30px, -20px) scale(3)`;
    next.click();
    expect(counter.textContent).toBe("3 / 3");
    expect(img.style.transform).toBe("translate(0px, 0px) scale(1)");
    // edge loop: next past the end wraps to the first
    next.click();
    expect(counter.textContent).toBe("1 / 3");
    // prev from the first wraps to the last
    prev.click();
    expect(counter.textContent).toBe("3 / 3");
  });

  it("navigates with the keyboard arrows", () => {
    openImageGallery(threeItems, 0);
    const counter = document.querySelector(
      `.${LIGHTBOX_CLASS}__counter`,
    ) as HTMLElement;
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(counter.textContent).toBe("2 / 3");
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    expect(counter.textContent).toBe("1 / 3");
  });

  it("hides the arrows for a single-item gallery", () => {
    openImageGallery([threeItems[0]], 0);
    const overlay = document.querySelector(`.${LIGHTBOX_CLASS}`) as HTMLElement;
    expect(overlay.querySelector(`.${LIGHTBOX_CLASS}__prev`)).toBeNull();
    expect(overlay.querySelector(`.${LIGHTBOX_CLASS}__next`)).toBeNull();
    expect(
      overlay.querySelector(`.${LIGHTBOX_CLASS}__counter`)?.textContent,
    ).toBe("1 / 1");
  });

  it("renders the caption of the current item, hiding an empty one", () => {
    openImageGallery(threeItems, 0);
    const overlay = document.querySelector(`.${LIGHTBOX_CLASS}`) as HTMLElement;
    const caption = overlay.querySelector(
      `.${LIGHTBOX_CLASS}__caption`,
    ) as HTMLElement;
    expect(caption.textContent).toBe("a.png");
    (overlay.querySelector(`.${LIGHTBOX_CLASS}__next`) as HTMLButtonElement).click();
    expect(caption.textContent).toBe("");
    expect(caption.style.display).toBe("none");
  });

  it("does nothing for an empty gallery", () => {
    openImageGallery([], 0);
    expect(document.querySelector(`.${LIGHTBOX_CLASS}`)).toBeNull();
  });

  it("drops a picture that fails to load and updates the counter", () => {
    openImageGallery(threeItems, 0);
    const overlay = document.querySelector(`.${LIGHTBOX_CLASS}`) as HTMLElement;
    const img = overlay.querySelector("img") as HTMLImageElement;
    const counter = overlay.querySelector(
      `.${LIGHTBOX_CLASS}__counter`,
    ) as HTMLElement;

    img.dispatchEvent(new Event("error"));
    expect(counter.textContent).toBe("1 / 2");
    // the next picture (now at the same position) takes over
    expect(img.getAttribute("src")).toBe("app://test/b.png");

    img.dispatchEvent(new Event("error"));
    expect(counter.textContent).toBe("1 / 1");
    expect(img.getAttribute("src")).toBe("app://test/c.png");
  });

  it("closes when the last remaining picture fails to load", () => {
    openImageGallery([threeItems[0]], 0);
    const overlay = document.querySelector(`.${LIGHTBOX_CLASS}`) as HTMLElement;
    overlay
      .querySelector("img")
      ?.dispatchEvent(new Event("error"));
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
    // mermaid's inline max-width is gone (the viewer's own transform style
    // is fine, a pinned max-width would fight the viewer's box)
    expect(clone?.getAttribute("style") ?? "").not.toContain("max-width");
    // the source node stays in place
    expect(svg.isConnected).toBe(true);
  });

  it("opens without a caption (diagram lightbox is captionless)", () => {
    openSvgLightbox(makeSvg({ viewBox: "0 0 10 10" }));
    const overlay = document.querySelector(`.${LIGHTBOX_CLASS}`);
    expect(overlay?.querySelector(`.${LIGHTBOX_CLASS}__caption`)).toBeNull();
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

  it("zooms by the buttons and double-clicks back to fit like an image", () => {
    openSvgLightbox(makeSvg({ viewBox: "0 0 10 10" }));
    const overlay = document.querySelector(`.${LIGHTBOX_CLASS}`) as HTMLElement;
    const svg = overlay.querySelector("svg") as SVGSVGElement;
    const zoomIn = [...overlay.querySelectorAll(".inscriptum-image-lightbox__zoom")].pop() as HTMLButtonElement;
    zoomIn.click();
    expect(overlay.classList.contains("is-zoomed")).toBe(true);
    expect(svg.style.transform).toContain("scale(1.25)");
    // double-click toggles back to fit (the viewBox is the natural size)
    svg.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    expect(overlay.classList.contains("is-zoomed")).toBe(false);
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
