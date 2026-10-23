import { expect, test } from "@playwright/test";
import { noteDoc, p } from "./fixtures/docs";
import {
  clickInsideText,
  docJson,
  mountToolbar,
  openHarness,
  topLevelTexts,
} from "./helpers";

const undoBtn = '.note-toolbar .note-toolbar__btn[aria-label="Undo"]';
const redoBtn = '.note-toolbar .note-toolbar__btn[aria-label="Redo"]';

test.describe("toolbar undo/redo buttons (mobile row)", () => {
  test("buttons render disabled on a fresh document", async ({ page }) => {
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("plain p1")));

    await expect(page.locator(undoBtn)).toBeVisible();
    await expect(page.locator(redoBtn)).toBeVisible();
    await expect(page.locator(undoBtn)).toBeDisabled();
    await expect(page.locator(redoBtn)).toBeDisabled();

    // Owner decision: the pair sits at the START of the mobile row, before
    // the typography groups — visible without scrolling the bar.
    const toolbar = page.locator(".note-toolbar");
    await expect(
      toolbar.evaluate((el) =>
        el.firstElementChild?.getAttribute("aria-label"),
      ),
    ).resolves.toBe("Undo");
    await expect(
      toolbar.evaluate((el) => el.children[1]?.getAttribute("aria-label")),
    ).resolves.toBe("Redo");
  });

  test("desktop header stays untouched (no undo/redo buttons)", async ({
    page,
  }) => {
    await openHarness(page);
    // mobile=false → no selectionBar prop → desktop branch of the toolbar.
    await mountToolbar(page, noteDoc(p("plain p1")), { mobile: false });

    await expect(page.locator(".note-toolbar")).toBeVisible();
    await expect(page.locator(undoBtn)).toHaveCount(0);
    await expect(page.locator(redoBtn)).toHaveCount(0);
    await expect(
      page.locator('.note-toolbar__btn[aria-label="Text"]'),
    ).toBeVisible();
  });

  test("keyboard undo refreshes the visible buttons", async ({ page }) => {
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("plain p1")));

    const para = page.locator(".texto-editor .ProseMirror > p", {
      hasText: "plain p1",
    });
    await clickInsideText(page, para, "plain p1", "end");
    await page.keyboard.type(" hello");
    await expect(page.locator(undoBtn)).toBeEnabled();

    // ⌘Z from the keyboard, not the button — the state update must still
    // reach the toolbar through the editor's update event.
    await page.keyboard.press("ControlOrMeta+z");
    expect(topLevelTexts(await docJson(page))).toEqual(["plain p1"]);
    await expect(page.locator(undoBtn)).toBeDisabled();
    await expect(page.locator(redoBtn)).toBeEnabled();
  });

  test("undo reverts typing, redo restores it", async ({ page }) => {
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("plain p1")));

    const para = page.locator(".texto-editor .ProseMirror > p", {
      hasText: "plain p1",
    });
    await clickInsideText(page, para, "plain p1", "end");
    await page.keyboard.type(" hello");
    expect(topLevelTexts(await docJson(page))).toEqual(["plain p1 hello"]);

    await expect(page.locator(undoBtn)).toBeEnabled();
    await page.locator(undoBtn).click();
    expect(topLevelTexts(await docJson(page))).toEqual(["plain p1"]);

    await expect(page.locator(redoBtn)).toBeEnabled();
    await page.locator(redoBtn).click();
    expect(topLevelTexts(await docJson(page))).toEqual(["plain p1 hello"]);

    // Redo put the edit back onto the undo stack: undo lives, redo drained.
    await expect(page.locator(undoBtn)).toBeEnabled();
    await expect(page.locator(redoBtn)).toBeDisabled();
  });

  test("repeated clicks walk several history steps both ways", async ({
    page,
  }) => {
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("plain p1")));

    const para = page.locator(".texto-editor .ProseMirror > p", {
      hasText: "plain p1",
    });
    await clickInsideText(page, para, "plain p1", "end");
    await page.keyboard.type(" hello");
    // prosemirror-history groups events within newGroupDelay (500 ms) —
    // wait it out so the two typings stay separate history steps.
    await page.waitForTimeout(600);
    await page.keyboard.type(" world");
    expect(topLevelTexts(await docJson(page))).toEqual([
      "plain p1 hello world",
    ]);

    const undo = page.locator(undoBtn);
    const redo = page.locator(redoBtn);
    await undo.click();
    expect(topLevelTexts(await docJson(page))).toEqual(["plain p1 hello"]);
    await undo.click();
    expect(topLevelTexts(await docJson(page))).toEqual(["plain p1"]);
    await expect(undo).toBeDisabled();

    await redo.click();
    expect(topLevelTexts(await docJson(page))).toEqual(["plain p1 hello"]);
    await redo.click();
    expect(topLevelTexts(await docJson(page))).toEqual([
      "plain p1 hello world",
    ]);
    await expect(redo).toBeDisabled();
  });

  test("the editor reports no errors while using the buttons", async ({
    page,
  }) => {
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("plain p1")));
    const para = page.locator(".texto-editor .ProseMirror > p", {
      hasText: "plain p1",
    });
    await clickInsideText(page, para, "plain p1", "end");
    await page.keyboard.type(" hello");
    await page.locator(undoBtn).click();
    await page.locator(redoBtn).click();

    const error = await page.evaluate(() => window.__e2e.lastError());
    expect(error).toBeNull();
  });
});
