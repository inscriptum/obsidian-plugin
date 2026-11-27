import { expect, test } from "@playwright/test";
import { noteDoc, table } from "./fixtures/docs";
import { mount, mountToolbar, openHarness, textRange } from "./helpers";

test("plain text pastes at the caret in a table cell", async ({ page }) => {
  await openHarness(page);
  await mount(page, noteDoc(table([["beforeAfter", "other"]])));
  const range = await textRange(page, "beforeAfter");
  await page.evaluate(({ pos }) => {
    const editor = window.__e2e.editor!;
    editor.commands.setTextSelection(pos);
    editor.view.focus();
    const dt = new DataTransfer();
    dt.setData("text/plain", "INSERT");
    editor.view.dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { pos: range.from + 6 });
  await expect(page.locator(".texto-editor th").first()).toHaveText("beforeINSERTAfter");
});

test("text copied from a cell pastes at a caret", async ({ page }) => {
  await openHarness(page);
  await mount(page, noteDoc(table([["SOURCE", "beforeAfter"]])));
  const source = await textRange(page, "SOURCE");
  const target = await textRange(page, "beforeAfter");
  await page.evaluate(({ source, target }) => {
    const editor = window.__e2e.editor!;
    editor.commands.setTextSelection({ from: source.from, to: source.to });
    const serialized = editor.view.serializeForClipboard(editor.state.selection.content());
    const html = serialized.dom.innerHTML;
    editor.commands.setTextSelection(target.from + 6);
    editor.view.focus();
    const dt = new DataTransfer();
    dt.setData("text/html", html);
    dt.setData("text/plain", serialized.text);
    editor.view.dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { source, target });
  await expect(page.locator(".texto-editor th").nth(1)).toHaveText("beforeSOURCEAfter");
});


test("formatted cell text replaces only the selected text and undo restores it", async ({ page }) => {
  await openHarness(page);
  const doc = noteDoc({
    type: "table",
    content: [{ type: "tableRow", content: [
      { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "BOLD", marks: [{ type: "bold" }] }] }] },
      { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "beforeMiddleAfter" }] }] },
    ] }],
  });
  await mount(page, doc);
  const source = await textRange(page, "BOLD");
  const target = await textRange(page, "beforeMiddleAfter");
  await page.evaluate(({ source, target }) => {
    const editor = window.__e2e.editor!;
    editor.commands.setTextSelection({ from: source.from, to: source.to });
    const copied = editor.view.serializeForClipboard(editor.state.selection.content());
    editor.commands.setTextSelection({ from: target.from + 6, to: target.from + 12 });
    editor.view.focus();
    const dt = new DataTransfer();
    dt.setData("text/html", copied.dom.innerHTML);
    dt.setData("text/plain", copied.text);
    editor.view.dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { source, target });
  const targetCell = page.locator(".texto-editor th").nth(1);
  await expect(targetCell).toHaveText("beforeBOLDAfter");
  await expect(targetCell.locator("strong")).toHaveText("BOLD");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(targetCell).toHaveText("beforeMiddleAfter");
});


test("toolbar paste keeps the text around the caret", async ({ page }) => {
  await openHarness(page);
  await mountToolbar(page, noteDoc(table([["SOURCE", "beforeAfter"]])));
  const source = await textRange(page, "SOURCE");
  const target = await textRange(page, "beforeAfter");
  await page.evaluate(({ source, target }) => {
    const editor = window.__e2e.editor!;
    editor.commands.setTextSelection({ from: source.from, to: source.to });
    const copied = editor.view.serializeForClipboard(editor.state.selection.content());
    const html = copied.dom.innerHTML;
    const text = copied.text;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      read: async () => [{ types: ["text/html", "text/plain"], getType: async (type: string) => new Blob([type === "text/html" ? html : text], { type }) }],
    } });
    editor.commands.setTextSelection(target.from + 6);
    editor.view.focus();
  }, { source, target });
  await page.getByRole("button", { name: "Table actions" }).click();
  await page.getByRole("button", { name: "Paste cells" }).click();
  await expect(page.locator(".texto-editor th").nth(1)).toHaveText("beforeSOURCEAfter");
});
