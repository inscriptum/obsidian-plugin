import { expect, test } from "@playwright/test";
import { noteDoc, p } from "./fixtures/docs";
import {
  clickInsideText,
  docJson,
  mount,
  openHarness,
  topLevelTexts,
} from "./helpers";

test.describe("editor smoke", () => {
  test("renders the mounted document", async ({ page }) => {
    await openHarness(page);
    await mount(page, noteDoc(p("plain p1"), p("plain p2")));

    const editor = page.locator(".texto-editor .ProseMirror");
    await expect(editor).toBeVisible();
    await expect(
      page.locator(".texto-editor .ProseMirror > p", { hasText: "plain p1" }),
    ).toBeVisible();
    await expect(
      page.locator(".texto-editor .ProseMirror > p", { hasText: "plain p2" }),
    ).toBeVisible();
  });

  test("typing inserts text at the caret", async ({ page }) => {
    await openHarness(page);
    await mount(page, noteDoc(p("plain p1")));

    const para = page.locator(".texto-editor .ProseMirror > p", {
      hasText: "plain p1",
    });
    await clickInsideText(page, para, "plain p1", "end");
    await page.keyboard.type(" hello");

    expect(topLevelTexts(await docJson(page))).toEqual(["plain p1 hello"]);
  });

  test("undo reverts typed text", async ({ page }) => {
    await openHarness(page);
    await mount(page, noteDoc(p("plain p1")));

    const para = page.locator(".texto-editor .ProseMirror > p", {
      hasText: "plain p1",
    });
    await clickInsideText(page, para, "plain p1", "end");
    await page.keyboard.type(" hello");
    await page.keyboard.press("ControlOrMeta+z");

    expect(topLevelTexts(await docJson(page))).toEqual(["plain p1"]);
  });

  test("the editor reports no errors while mounting and typing", async ({
    page,
  }) => {
    await openHarness(page);
    await mount(page, noteDoc(p("plain p1")));
    const para = page.locator(".texto-editor .ProseMirror > p", {
      hasText: "plain p1",
    });
    await clickInsideText(page, para, "plain p1", "end");
    await page.keyboard.type(" more");

    const error = await page.evaluate(() => window.__e2e.lastError());
    expect(error).toBeNull();
  });
});
