import { expect, test } from "@playwright/test";
import { noteDoc, p, table } from "./fixtures/docs";
import { mountToolbar, openHarness, textRange } from "./helpers";

test("leaving the table context returns to the main dock", async ({ page }) => {
  await openHarness(page);
  await mountToolbar(page, noteDoc(p("before"), table([["one", "two"]]), p("after")));
  await page.locator(".texto-editor td, .texto-editor th").first().click();
  await expect(page.locator(".menu-dock__group")).toHaveCount(4);
  await page.locator(".menu-dock__group").last().click();
  await expect(page.locator(".menu-dock__group")).toHaveCount(5);
  expect(await page.evaluate(() => window.__e2e.editor!.state.selection.$from.parent.textContent)).toBe("after");
});

test("opening a panel preserves the selected text", async ({ page }) => {
  await openHarness(page);
  await mountToolbar(page, noteDoc(p("alpha bravo")));
  const range = await textRange(page, "alpha bravo");
  await page.evaluate(({ from, to }) => {
    const editor = window.__e2e.editor!;
    editor.view.focus();
    editor.commands.setTextSelection({ from, to });
  }, range);
  await page.locator(".menu-dock__group").first().click();
  await expect(page.locator(".menu-dock__panel")).toBeVisible();
  expect(await page.evaluate(() => {
    const { from, to } = window.__e2e.editor!.state.selection;
    return { from, to };
  })).toEqual(range);
  await expect(page.locator(".ProseMirror .menu-dock-selection")).toHaveText("alpha bravo");
});

test("block styles preserve a multi-paragraph selection for subsequent formatting", async ({ page }) => {
  await openHarness(page);
  await mountToolbar(page, noteDoc(p("alpha"), p("bravo")));
  const from = await textRange(page, "alpha");
  const to = await textRange(page, "bravo");
  await page.evaluate(({ start, end }) => window.__e2e.editor!.commands.setTextSelection({ from: start, to: end }), { start: from.from, end: to.to });
  await page.getByRole("button", { name: "Styles and color" }).click();
  await page.getByRole("button", { name: "Heading 1", exact: true }).click();
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.locator('.menu-dock__swatch[title="Purple"]').click();
  await expect(page.locator('.ProseMirror h1 span[style*="color"]')).toHaveCount(2);
});

test("blurred caret remains visible while a block panel is open", async ({ page }) => {
  await openHarness(page);
  await mountToolbar(page, noteDoc(p("alpha bravo")));
  const range = await textRange(page, "alpha bravo");
  await page.evaluate((pos) => {
    const editor = window.__e2e.editor!;
    editor.view.focus();
    editor.commands.setTextSelection(pos);
  }, range.from + 3);
  await page.getByRole("button", { name: "Text and headings" }).click();
  await expect(page.locator(".ProseMirror .menu-dock-caret")).toHaveCount(1);
  await page.getByRole("button", { name: "Heading 1", exact: true }).click();
  await expect(page.locator(".ProseMirror h1 .menu-dock-caret")).toHaveCount(1);
});

test("link applies to the mapped selection after an edit before it", async ({ page }) => {
  await openHarness(page);
  await mountToolbar(page, noteDoc(p("alpha bravo")));
  const range = await textRange(page, "alpha bravo");
  await page.evaluate(({ from, to }) => window.__e2e.editor!.commands.setTextSelection({ from, to }), range);
  await page.getByRole("button", { name: "Link", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Link URL" });
  await input.fill("https://example.com");
  await page.evaluate(() => {
    const editor = window.__e2e.editor!;
    editor.view.dispatch(editor.state.tr.insertText("X", editor.state.selection.from));
  });
  await page.getByRole("button", { name: "Apply link" }).click();
  await expect(page.locator('.texto-editor a[href="https://example.com"]')).toHaveText("alpha bravo");
});

test("editing the held range invalidates HEX until a new selection", async ({ page }) => {
  await openHarness(page);
  await mountToolbar(page, noteDoc(p("alpha bravo")));
  const range = await textRange(page, "alpha bravo");
  await page.evaluate(({ from, to }) => window.__e2e.editor!.commands.setTextSelection({ from, to }), range);
  await page.getByRole("button", { name: "Styles and color" }).click();
  const input = page.getByRole("textbox", { name: "Text color HEX" });
  await input.fill("#123456");
  await page.evaluate(() => {
    const editor = window.__e2e.editor!;
    editor.view.dispatch(editor.state.tr.insertText("X", editor.state.selection.from + 2));
  });
  await expect(page.getByRole("status")).toContainText("Select text again");
  await input.press("Enter");
  await expect(page.locator('.texto-editor [style*="color"]')).toHaveCount(0);
});

test("inserts on either boundary stay outside a backwards selection", async ({ page }) => {
  await openHarness(page);
  await mountToolbar(page, noteDoc(p("alpha bravo")));
  const range = await textRange(page, "alpha bravo");
  await page.evaluate(({ from, to }) => {
    const editor = window.__e2e.editor!;
    editor.view.focus();
    editor.commands.setTextSelection({ from: to, to: from });
  }, range);
  await expect.poll(() => page.evaluate(() => window.__e2e.editor!.state.selection.empty)).toBe(false);
  await page.getByRole("button", { name: "Link", exact: true }).click();
  await page.getByRole("textbox", { name: "Link URL" }).fill("https://example.com");
  await page.evaluate(({ from, to }) => {
    const editor = window.__e2e.editor!;
    editor.view.dispatch(editor.state.tr.insertText("Y", to).insertText("X", from));
  }, range);
  await page.getByRole("button", { name: "Apply link" }).click();
  await expect(page.locator('.texto-editor a[href="https://example.com"]')).toHaveText("alpha bravo");
  await expect(page.locator(".texto-editor .ProseMirror > p")).toContainText("Xalpha bravoY");
});

test("destructive actions are unavailable when confirmation is unavailable", async ({ page }) => {
  await openHarness(page);
  await mountToolbar(page, noteDoc(p("before"), table([["one", "two"]])));
  await page.locator(".texto-editor td, .texto-editor th").first().click();
  await page.locator(".menu-dock__group").first().click();
  const deleteTable = page.locator(".menu-dock__action.is-danger").last();
  await expect(deleteTable).toHaveAttribute("aria-disabled", "true");
  await deleteTable.click({ force: true });
  await expect(page.locator(".texto-editor table")).toHaveCount(1);
});


test("attachment context identifies the selected object", async ({ page }) => {
  await openHarness(page);
  await mountToolbar(page, noteDoc({ type: "attachment", attrs: { key: "file", data: { id: "file.pdf", filename: "file.pdf" } } }));
  await page.evaluate(() => {
    const editor = window.__e2e.editor!;
    let pos = 0;
    editor.state.doc.forEach((node, offset) => { if (node.type.name === "attachment") pos = offset; });
    editor.commands.setNodeSelection(pos);
  });
  await expect(page.getByRole("button", { name: "Object actions" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Layout" })).toHaveCount(0);
});
