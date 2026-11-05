import { expect, test } from "@playwright/test";
import { noteDoc, p } from "./fixtures/docs";
import { docJson, findText, mount, openHarness } from "./helpers";

const EDITOR = ".texto-editor .ProseMirror";

test.describe("text cut Mod-x", () => {
  test("Cmd+X cuts the selected text natively", async ({ page }) => {
    await openHarness(page);
    await mount(page, noteDoc(p("keep this"), p("cut me please")));
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);

    // Select the whole second paragraph ("cut me please") with a real drag:
    // start before the line and overshoot past its end so the drag covers
    // the full text even when a parallel test steals a few frames.
    const box = await page.evaluate(() => {
      const host = document.querySelector(".texto-editor .ProseMirror")!;
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if ((node.textContent ?? "").includes("cut me")) {
          const range = document.createRange();
          range.selectNodeContents(node);
          const r = range.getBoundingClientRect();
          return { x: r.left + 2, y: r.top + r.height / 2, end: r.right + 10 };
        }
      }
      return null;
    });
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x, box!.y);
    await page.mouse.down();
    await page.mouse.move(box!.end, box!.y, { steps: 8 });
    await page.mouse.up();

    // The selection covers the paragraph text — verbatim.
    await page.waitForFunction(() =>
      (window.getSelection()?.toString() ?? "").includes("cut me please"),
    );

    // Real keyboard cut.
    await page.keyboard.press("ControlOrMeta+x");
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".texto-editor .ProseMirror")
          ?.textContent?.includes("cut me please"),
    );

    // The text is gone from the doc…
    const json = await docJson(page);
    expect(findText(json, "cut me please")).toBeUndefined();
    expect(findText(json, "keep this")).toBeTruthy();

    // …and lands on the system clipboard (paste it over a word selection).
    const keep = await page.evaluate(() => {
      const host = document.querySelector(".texto-editor .ProseMirror")!;
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if ((node.textContent ?? "").includes("keep")) {
          const range = document.createRange();
          range.selectNodeContents(node);
          const r = range.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
      }
      return null;
    });
    expect(keep).not.toBeNull();
    await page.mouse.dblclick(keep!.x, keep!.y);
    await page.keyboard.press("ControlOrMeta+v");
    await page.waitForFunction(() =>
      document
        .querySelector(".texto-editor .ProseMirror")
        ?.textContent?.includes("cut me please"),
    );
    // The dblclick selected the word "keep" — the paste lands in its place
    // (the remainder of the line stays), so assert on containment.
    expect(JSON.stringify(await docJson(page))).toContain("cut me please");
  });
});
