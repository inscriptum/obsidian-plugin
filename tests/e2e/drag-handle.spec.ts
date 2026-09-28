import { expect, test, type Locator } from "@playwright/test";
import { noteDoc, p } from "./fixtures/docs";
import { docJson, mount, openHarness, topLevelTexts } from "./helpers";

const EDITOR = ".texto-editor .ProseMirror";

async function boundingBox(locator: Locator): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  const box = await locator.boundingBox();
  if (box == null) {
    throw new Error("element has no bounding box");
  }
  return box;
}

test.describe("drag handle", () => {
  test("dragging a paragraph by its handle reorders the blocks", async ({
    page,
  }) => {
    await openHarness(page);
    await mount(page, noteDoc(p("first"), p("second")));

    const first = page.locator(`${EDITOR} > p`, { hasText: "first" });
    await first.hover();

    const handle = page.locator(".texto-editor .texto-drag-handle.is-visible");
    await expect(handle).toBeVisible();
    const handleBox = await boundingBox(handle);

    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();

    const second = page.locator(`${EDITOR} > p`, { hasText: "second" });
    const secondBox = await boundingBox(second);
    // Target the LOWER half of the "second" block: the drop boundary is
    // then after it, so "first" must land last. (Below the last block
    // posAtCoords gives no target and the drop cancels.)
    await page.mouse.move(
      secondBox.x + 30,
      secondBox.y + secondBox.height - 3,
      { steps: 20 },
    );

    // The drop indicator must be on while dragging with a live target.
    await expect(page.locator(".texto-drag-drop-line").first()).toBeVisible();

    await page.mouse.up();

    expect(topLevelTexts(await docJson(page))).toEqual(["second", "first"]);
  });

  test("dropping the block back onto itself cancels the move", async ({
    page,
  }) => {
    await openHarness(page);
    await mount(page, noteDoc(p("first"), p("second")));

    const first = page.locator(`${EDITOR} > p`, { hasText: "first" });
    await first.hover();

    const handle = page.locator(".texto-editor .texto-drag-handle.is-visible");
    await expect(handle).toBeVisible();
    const handleBox = await boundingBox(handle);

    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    // Move well past the threshold to arm the drag, then release over the
    // dragged block itself — a no-op drop.
    const firstBox = await boundingBox(first);
    await page.mouse.move(firstBox.x + 30, firstBox.y + firstBox.height / 2, {
      steps: 10,
    });
    await page.mouse.up();

    expect(topLevelTexts(await docJson(page))).toEqual(["first", "second"]);
  });
});
