import { expect, test } from "@playwright/test";
import { noteDoc, p, table } from "./fixtures/docs";
import { clickInsideText, mount, openHarness, pressEndOfLine } from "./helpers";

const EDITOR = ".texto-editor";

test.describe("tables", () => {
  test("typing in a cell edits its paragraph", async ({ page }) => {
    await openHarness(page);
    await mount(
      page,
      noteDoc(
        table([
          ["A1", "B1"],
          ["A2", "B2"],
        ]),
      ),
    );

    const cell = page.locator(`${EDITOR} td`, { hasText: "A2" });
    await clickInsideText(page, cell.locator("p"), "A2");
    await pressEndOfLine(page);
    await page.keyboard.type("X");

    await expect(cell.locator("p")).toHaveText("A2X");
  });

  test("Tab moves the selection to the next cell", async ({ page }) => {
    await openHarness(page);
    await mount(
      page,
      noteDoc(
        table([
          ["A1", "B1"],
          ["A2", "B2"],
        ]),
      ),
    );

    await clickInsideText(
      page,
      page.locator(`${EDITOR} th`, { hasText: "A1" }).locator("p"),
      "A1",
    );
    await page.keyboard.press("Tab");
    // Tab selects the whole next cell, so typing replaces its content.
    // (Locate the target cell by index: its old text "B1" is gone now.)
    await page.keyboard.type("!");

    const headers = page.locator(`${EDITOR} th`);
    await expect(headers.nth(0).locator("p")).toHaveText("A1");
    await expect(headers.nth(1).locator("p")).toHaveText("!");
  });
});

test.describe("images in table cells", () => {
  const CELL_PX = 300;

  const cellImageDoc = (align: string, width: string | null) =>
    noteDoc({
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableHeader",
              attrs: { colspan: 1, rowspan: 1, colwidth: [CELL_PX] },
              content: [p("H")],
            },
            {
              type: "tableCell",
              attrs: { colspan: 1, rowspan: 1, colwidth: [CELL_PX] },
              content: [
                {
                  type: "image",
                  attrs: {
                    key: "k1",
                    align,
                    width,
                    data: { id: "a1", size: "9", filename: "pic.png" },
                  },
                },
                { type: "paragraph" },
              ],
            },
          ],
        },
      ],
    });

  test("full-width image inside a cell spans the cell edge to edge", async ({
    page,
  }) => {
    await openHarness(page);
    await mount(page, cellImageDoc("full", null));

    const host = page.locator(`${EDITOR} td .texto-extension-image-host`);
    await expect(host).toHaveClass(/texto-image-layout-full/);

    const widths = await host.evaluate((el) => {
      const cell = el.closest("td") as HTMLElement;
      const cellStyle = window.getComputedStyle(cell);
      return {
        host: el.getBoundingClientRect().width,
        // inner width including the cell's horizontal padding (excludes
        // the 1px borders) — what "full width of the cell" means
        cellInner: cell.clientWidth,
        padX: parseFloat(cellStyle.paddingLeft),
        editor: (el.closest(".texto-editor") as HTMLElement).clientWidth,
      };
    });
    // Edge to edge: the host spans the whole cell box (padding included),
    // not the padded content box — no insets at either side.
    expect(Math.abs(widths.host - widths.cellInner)).toBeLessThanOrEqual(1);
    expect(widths.padX).toBeGreaterThan(0);
    // The 100cqw full-bleed of the top level would spill past the 300px cell
    // and span the whole editor; inside the cell it must not.
    expect(widths.host).toBeLessThan(widths.editor * 0.8);
  });

  test("resize handles write a percent of the CELL width", async ({ page }) => {
    await openHarness(page);
    await mount(page, cellImageDoc("left", null));

    const host = page.locator(`${EDITOR} td .texto-extension-image-host`);
    await host.click();

    const handle = host.locator(".image-resize-handle-right");
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();

    // Absolute anchor for the drag: dragging the right handle left by
    // PIXELS must shrink the image by the same pixels (within the integer
    // percent rounding). This pins the reference width — with the wrong
    // reference (e.g. the editor instead of the cell) the committed percent
    // would still render as a valid N% of the cell but the pixel math
    // would be off by 100+ px.
    const startWidth = await host.evaluate(
      (el) => el.getBoundingClientRect().width,
    );
    const DRAG_PX = 60;

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x - DRAG_PX, box!.y + box!.height / 2, {
      steps: 5,
    });
    await page.mouse.up();

    // The committed width lives in the node attrs (data-width only appears
    // in serialization); the DOM host keeps the live inline style.
    const result = await page.evaluate(() => {
      let width: string | null = null;
      window.__e2e.editor?.state.doc.descendants((n) => {
        if (n.type.name === "image") {
          width = (n.attrs.width as string | null) ?? null;
          return false;
        }
        return true;
      });
      const host = document.querySelector(
        "td .texto-extension-image-host",
      ) as HTMLElement | null;
      const cell = host?.closest("td") as HTMLElement | null;
      const style = cell ? window.getComputedStyle(cell) : null;
      const pad = style
        ? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
        : 0;
      return {
        width,
        host: host?.getBoundingClientRect().width ?? 0,
        cellInner: cell ? cell.getBoundingClientRect().width - pad : 0,
      };
    });

    // Pointer travel: down at the handle center, up 60px to the left —
    // a 5px wider handle makes the travel 65px.
    const handleCenterOffset = box!.width / 2;
    expect(
      Math.abs(result.host - (startWidth - DRAG_PX - handleCenterOffset)),
    ).toBeLessThanOrEqual(6);
    expect(result.width).toMatch(/^\d+%$/);
    const percent = parseInt(result.width!, 10);
    // ±5px: the committed percent is rounded to an integer, so the rendered
    // host deviates by up to ~0.5% of the cell. A wrong reference (editor
    // instead of cell) would miss by hundreds of px.
    expect(result.host).toBeCloseTo((result.cellInner * percent) / 100, -1);
  });
});
