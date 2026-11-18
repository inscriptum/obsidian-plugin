import { expect, test } from "@playwright/test";
import { openHarness } from "./helpers";
import { p } from "./fixtures/docs";

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

test("diagram touch binds the phone toolbar to its page without focusing the editor", async ({ page }) => {
  await openHarness(page);
  const pages = [
    { id: "first", paragraphs: 0, doc: [p("first page")] },
    { id: "second", paragraphs: 0, doc: [p("second page"), { type: "mermaid", attrs: { code: "flowchart TD\n A[Start] --> B[End]" } }] },
  ];
  await page.evaluate((data) => window.__e2eNotepad.mount(data, { titleExpanded: false, phone: true }), pages);
  await expect.poll(() => page.evaluate(() => window.__e2eNotepad.editors().length)).toBe(3);
  await page.evaluate(() => window.__e2eNotepad.editors()[1].view.focus());
  const svg = page.locator(".texto-extension-mermaid-host .mermaid-view__svg svg");
  await expect(svg).toBeVisible();
  await svg.tap();
  await expect.poll(() => page.evaluate(() => {
    const editors = window.__e2eNotepad.editors();
    const toolbar = document.querySelector(".notepad-toolbar") as unknown as { props: { editor: unknown } } | null;
    return { owner: editors.indexOf(toolbar?.props.editor as typeof editors[number]), selected: editors[2].state.selection.toJSON().type, focused: editors[2].view.hasFocus() };
  })).toEqual({ owner: 2, selected: "node", focused: false });
  await expect(page.getByRole("button", { name: "Object actions" })).toBeVisible();
});
