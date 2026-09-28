import { expect, test } from "@playwright/test";
import { noteDoc, p, taskList } from "./fixtures/docs";
import { docJson, mount, nodesOfType, openHarness } from "./helpers";

const EDITOR = ".texto-editor";

test.describe("tasks and folding", () => {
  test("clicking a task checkbox updates checked", async ({ page }) => {
    await openHarness(page);
    await mount(
      page,
      noteDoc(taskList([{ text: "todo one" }, { text: "todo two" }])),
    );

    // Task items render as custom-element hosts (no li in the live DOM);
    // the checkbox lives inside the host's label.
    await page
      .locator(`${EDITOR} .texto-extension-task-item-host`, {
        hasText: "todo one",
      })
      .locator("label")
      .click();

    const items = nodesOfType(await docJson(page), "taskItem");
    expect(items).toHaveLength(2);
    expect(items[0]?.attrs?.checked).toBe(true);
    expect(items[1]?.attrs?.checked).toBe(false);
  });

  test("clicking the heading chevron folds its section", async ({ page }) => {
    await openHarness(page);
    await mount(
      page,
      noteDoc(
        p("before heading"),
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "S1" }] },
        p("under heading"),
      ),
    );

    const chevron = page.locator(".texto-heading-fold-chevron-host");
    await chevron.hover();
    await chevron.click();

    await expect
      .poll(() => page.evaluate(() => window.__e2e.headingFolds()))
      .not.toEqual([]);
    await expect(
      page.locator(`${EDITOR} .ProseMirror > p`, { hasText: "under heading" }),
    ).toHaveClass(/texto-folded-content/);
  });

  test("clicking a nested task chevron folds its subtasks", async ({
    page,
  }) => {
    await openHarness(page);
    await mount(
      page,
      noteDoc(
        taskList([
          { text: "todo parent", sub: [{ text: "sub 1" }, { text: "sub 2" }] },
        ]),
      ),
    );

    const chevron = page.locator(".texto-task-fold-chevron").first();
    await chevron.hover();
    await chevron.click();

    await expect
      .poll(() => page.evaluate(() => window.__e2e.taskFolds()))
      .not.toEqual([]);
  });
});
