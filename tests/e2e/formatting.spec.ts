import { expect, test } from "@playwright/test";
import { noteDoc, p } from "./fixtures/docs";
import { docJson, findText, mount, openHarness } from "./helpers";

const EDITOR = ".texto-editor .ProseMirror";

/** Screen coords of the given text-offset span inside the first paragraph. */
async function spanBox(
  page: import("@playwright/test").Page,
  from: number,
  to: number,
): Promise<{ x: number; y: number }> {
  const box = await page.evaluate(
    ({ f, t }) => {
      const pEl = document.querySelector(".texto-editor .ProseMirror > p");
      const text = pEl?.firstChild;
      if (text == null) {
        return null;
      }
      const range = document.createRange();
      range.setStart(text, f);
      range.setEnd(text, t);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    },
    { f: from, t: to },
  );
  if (box == null) {
    throw new Error("paragraph text node not found");
  }
  return box;
}

test.describe("formatting", () => {
  test("Mod-B toggles bold on the selected word", async ({ page }) => {
    await openHarness(page);
    await mount(page, noteDoc(p("hello")));

    // Dblclick the word's own glyphs — a dblclick at the paragraph center
    // maps to a caret past the text and the word selection flakes.
    const word = await spanBox(page, 0, 5);
    await page.mouse.dblclick(word.x, word.y);
    await page.keyboard.press("ControlOrMeta+b");

    const bolded = findText(await docJson(page), "hello");
    expect(bolded?.marks?.map((mark) => mark.type)).toContain("bold");

    await page.keyboard.press("ControlOrMeta+b");
    const cleared = findText(await docJson(page), "hello");
    expect(cleared?.marks?.map((mark) => mark.type) ?? []).not.toContain("bold");
  });

  test("Mod-I applies italic to the selected word", async ({ page }) => {
    await openHarness(page);
    await mount(page, noteDoc(p("hello")));

    const word = await spanBox(page, 0, 5);
    await page.mouse.dblclick(word.x, word.y);
    await page.keyboard.press("ControlOrMeta+i");

    const italicized = findText(await docJson(page), "hello");
    expect(italicized?.marks?.map((mark) => mark.type)).toContain("italic");
  });

  test("Mod-B bolds only the drag-selected word", async ({ page }) => {
    await openHarness(page);
    await mount(page, noteDoc(p("alpha beta gamma")));

    // Screen coords of the word "beta" (text offsets 6..10) via a Range —
    // keyboard selection is unreliable in headless Chromium, but a mouse
    // drag over exact glyph boxes is deterministic.
    const box = await page.evaluate(() => {
      const pEl = document.querySelector(".texto-editor .ProseMirror > p");
      const text = pEl?.firstChild;
      if (text == null) {
        return null;
      }
      const range = document.createRange();
      range.setStart(text, 6);
      range.setEnd(text, 10);
      const rect = range.getBoundingClientRect();
      return { x1: rect.left, x2: rect.right, y: rect.top + rect.height / 2 };
    });
    if (box == null) {
      throw new Error("paragraph text node not found");
    }

    await page.mouse.move(box.x1 + 1, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x2 - 1, box.y, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.press("ControlOrMeta+b");

    const doc = await docJson(page);
    expect(findText(doc, "beta")?.marks?.map((mark) => mark.type)).toContain(
      "bold",
    );
    expect(findText(doc, "alpha")?.marks ?? []).toEqual([]);
    expect(findText(doc, "gamma")?.marks ?? []).toEqual([]);
  });
});
