import { expect, test, type Page } from "@playwright/test";
import { deflateSync } from "node:zlib";
import { openHarness } from "./helpers";

/** Minimal valid PNG (truecolor RGB) of the given size and color — built in
 *  the test process, no fixtures. */
function pngBytes(width: number, height: number, rgb: [number, number, number]): string {
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.concat(Array.from({ length: width }, () => Buffer.from(rgb))),
  ]);
  const idat = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return `data:image/png;base64,${Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64")}`;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}


async function boxOf(locator: ReturnType<Page["locator"]>): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  const box = await locator.boundingBox();
  if (box == null) throw new Error("element has no bounding box");
  return box;
}

const PNG_A = pngBytes(220, 140, [200, 40, 40]);
const PNG_B = pngBytes(300, 90, [40, 60, 200]);

const ITEMS = [
  { id: "a.png", src: PNG_A, filename: "a.png" },
  { id: "b.png", src: PNG_B, filename: "b.png" },
  { id: "c.png", src: PNG_A, filename: null },
];

async function openViewer(page: Page, index = 0): Promise<void> {
  await openHarness(page);
  await page.evaluate(
    ({ items, index: i }) => window.__e2e.openGallery(items, i),
    { items: ITEMS as unknown[], index },
  );
  await expect(page.locator(".inscriptum-image-lightbox")).toBeVisible();
}

async function transformOf(page: Page): Promise<{ scale: number; x: number }> {
  return page.evaluate(() => {
    const img = document.querySelector(
      ".inscriptum-image-lightbox img",
    ) as HTMLImageElement;
    const t = new DOMMatrixReadOnly(getComputedStyle(img).transform);
    return { scale: t.a, x: t.e };
  });
}

test.describe("lightbox viewer (gallery + zoom)", () => {
  test("gallery navigates with arrows, loops the edges, resets zoom", async ({
    page,
  }) => {
    await openViewer(page, 0);
    const overlay = page.locator(".inscriptum-image-lightbox");
    const counter = overlay.locator(".inscriptum-image-lightbox__counter");

    await expect(counter).toHaveText("1 / 3");
    await expect(overlay.locator("img")).toHaveAttribute("src", PNG_A);
    await expect(overlay.locator(".inscriptum-image-lightbox__caption")).toHaveText(
      "a.png",
    );

    await page.keyboard.press("ArrowRight");
    await expect(counter).toHaveText("2 / 3");
    await expect(overlay.locator("img")).toHaveAttribute("src", PNG_B);
    await expect(overlay.locator(".inscriptum-image-lightbox__caption")).toHaveText(
      "b.png",
    );

    await overlay.locator(".inscriptum-image-lightbox__next").click();
    await expect(counter).toHaveText("3 / 3");
    // a null filename hides the caption strip
    await expect(overlay.locator(".inscriptum-image-lightbox__caption")).toBeHidden();
    // past the end → wrap to the first (looping edges)
    await overlay.locator(".inscriptum-image-lightbox__next").click();
    await expect(counter).toHaveText("1 / 3");
    // prev from the first wraps to the last
    await overlay.locator(".inscriptum-image-lightbox__prev").click();
    await expect(counter).toHaveText("3 / 3");
  });

  test("wheel zooms at the cursor, buttons step, double-click toggles fit/100%", async ({
    page,
  }) => {
    await openViewer(page, 0);
    const overlay = page.locator(".inscriptum-image-lightbox");
    const img = overlay.locator("img");
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);

    // wheel over the image zooms in (deltaY < 0)
    const box = await boxOf(img);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const before = await transformOf(page);
    await page.mouse.wheel(0, -240);
    const zoomed = await transformOf(page);
    expect(zoomed.scale).toBeGreaterThan(before.scale);
    // the wheel cursor was over the object → zoom kept that point pinned
    // (translate moved), and the zoom state is visible in the cursor
    await expect(overlay).toHaveClass(/is-zoomed/);

    // double-click returns to fit
    await img.dblclick();
    expect((await transformOf(page)).scale).toBeCloseTo(1, 6);

    // buttons step around the center
    await overlay.locator(".inscriptum-image-lightbox__zoom").last().click();
    const stepped = await transformOf(page);
    expect(stepped.scale).toBeCloseTo(1.25, 1);
    await overlay.locator(".inscriptum-image-lightbox__zoom").first().click();
    expect((await transformOf(page)).scale).toBeCloseTo(1, 6);
  });

  test("a zoomed picture pans by drag, clamped to the viewport", async ({
    page,
  }) => {
    await openViewer(page, 0);
    const overlay = page.locator(".inscriptum-image-lightbox");
    const img = overlay.locator("img");
    const box = await boxOf(img);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -480); // zoom in clearly
    const zoomed = await transformOf(page);
    expect(zoomed.scale).toBeGreaterThan(2);

    // drag left: the translate follows the pointer
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2, {
      steps: 5,
    });
    await page.mouse.up();
    const dragged = await transformOf(page);
    expect(dragged.x).toBeLessThan(zoomed.x);

    // the drag cannot push the picture fully off screen: a huge drag lands
    // on the clamp, not past it
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 5000, box.y + box.height / 2, {
      steps: 5,
    });
    await page.mouse.up();
    const clamped = await transformOf(page);
    const viewport = page.viewportSize() as { width: number; height: number };
    expect(Math.abs(clamped.x)).toBeLessThanOrEqual(
      viewport.width / 2 + (box.width * zoomed.scale) / 2,
    );
    // the pan kept part of the image visible
    const visible = await img.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.right > 0 && r.left < window.innerWidth;
    });
    expect(visible).toBe(true);
  });

  test("pinch follows the fingers: spread plus a moving midpoint pans", async ({
    page,
  }) => {
    await openViewer(page, 0);
    const overlay = page.locator(".inscriptum-image-lightbox");
    const img = overlay.locator("img");
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);
    const box = await boxOf(img);
    const cy = Math.round(box.y + box.height / 2);
    const spread = async (leftX: number, rightX: number) => {
      await page.evaluate(
        async ([l, r, y]) => {
          const pe = (id: number, x: number, yy: number, type: string) =>
            new PointerEvent(type, {
              clientX: x,
              clientY: yy,
              bubbles: true,
              cancelable: true,
              pointerId: id,
              pointerType: "touch",
              isPrimary: id === 1,
              buttons: 1,
            });
          const target = document.querySelector(
            ".inscriptum-image-lightbox img",
          ) as HTMLElement;
          target.dispatchEvent(pe(1, l, y, "pointermove"));
          target.dispatchEvent(pe(2, r, y, "pointermove"));
        },
        [leftX, rightX, cy],
      );
    };
    // grab: two fingers 80px apart around the center
    await page.evaluate(
      async ([l, r, y]) => {
        const pe = (id: number, x: number, yy: number, type: string) =>
          new PointerEvent(type, {
            clientX: x,
            clientY: yy,
            bubbles: true,
            cancelable: true,
            pointerId: id,
            pointerType: "touch",
            isPrimary: id === 1,
            buttons: 1,
          });
        const target = document.querySelector(
          ".inscriptum-image-lightbox img",
        ) as HTMLElement;
        target.dispatchEvent(pe(1, l, y, "pointerdown"));
        target.dispatchEvent(pe(2, r, y, "pointerdown"));
      },
      [box.x + box.width / 2 - 40, box.x + box.width / 2 + 40, cy],
    );
    // spread to double the distance AND drift the midpoint 60px right:
    // the picture must scale AND follow the midpoint (not slide away)
    for (let step = 1; step <= 4; step += 1) {
      const half = 40 + step * 20;
      await spread(
        box.x + box.width / 2 + 60 * (step / 4) - half,
        box.x + box.width / 2 + 60 * (step / 4) + half,
      );
    }
    const zoomed = await transformOf(page);
    expect(zoomed.scale).toBeGreaterThan(1.5);
    expect(zoomed.x).toBeGreaterThan(0);
    // release both fingers
    await page.evaluate(() => {
      const target = document.querySelector(
        ".inscriptum-image-lightbox img",
      ) as HTMLElement;
      const pe = (id: number) =>
        new PointerEvent("pointerup", {
          clientX: 0,
          clientY: 0,
          bubbles: true,
          cancelable: true,
          pointerId: id,
          pointerType: "touch",
          isPrimary: id === 1,
        });
      target.dispatchEvent(pe(1));
      target.dispatchEvent(pe(2));
    });
    await page.evaluate(() => {
      document.querySelector(".inscriptum-image-lightbox .inscriptum-image-lightbox__close")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await expect(overlay).toHaveCount(0);
  });

  test("closing model: only the background, ✕ and Esc close; switching works while zoomed", async ({
    page,
  }) => {
    await openViewer(page, 0);
    const overlay = page.locator(".inscriptum-image-lightbox");
    const img = overlay.locator("img");

    // clicks and double clicks on the object never close
    await img.click();
    await img.dblclick();
    await expect(overlay).toBeVisible();

    // zoomed, then switch: the next picture comes back to fit
    const box = await boxOf(img);
    await page.mouse.move(box.x + 2, box.y + 2);
    await page.mouse.wheel(0, -240);
    await overlay.locator(".inscriptum-image-lightbox__next").click();
    expect((await transformOf(page)).scale).toBeCloseTo(1, 6);

    // the bar and arrows are not the background either
    await overlay.locator(".inscriptum-image-lightbox__counter").click();
    await expect(overlay).toBeVisible();

    // background click closes
    await overlay.click({ position: { x: 4, y: 4 } });
    await expect(overlay).toHaveCount(0);

    // ✕ and Esc close a reopened viewer
    await openViewer(page, 2);
    await overlay.locator(".inscriptum-image-lightbox__close").click();
    await expect(overlay).toHaveCount(0);
    await openViewer(page, 0);
    await page.keyboard.press("Escape");
    await expect(overlay).toHaveCount(0);
  });
});
