import { expect, test } from "@playwright/test";
import { noteDoc, p } from "./fixtures/docs";
import { clickInsideText, docJson, mount, openHarness } from "./helpers";

const FILES = [
  { path: "notes/planning.um", name: "planning" },
  { path: "notes/plan b.md", name: "plan b" },
  { path: "daily/2026-10-24.md", name: "2026-10-24" },
];

test.describe("wiki-link «[[» suggest (inline syntax)", () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
    await page.evaluate((files) => {
      window.__e2eWiki.files = files;
      window.__e2eWiki.opens = [];
    }, FILES);
    await mount(page, noteDoc(p("plain p1")));
  });

  async function typeTrigger(page: import("@playwright/test").Page): Promise<void> {
    const para = page.locator(".texto-editor .ProseMirror > p", {
      hasText: "plain p1",
    });
    await clickInsideText(page, para, "plain p1", "end");
    await page.keyboard.type(" see [[");
    await page.waitForTimeout(120);
  }

  test("typing «[[» opens the popup with name, path and the hint bar", async ({
    page,
  }) => {
    await typeTrigger(page);

    const popup = page.locator(".texto-wiki-suggest");
    await expect(popup).toBeVisible();
    const names = await popup.locator(".texto-wiki-suggest__name").allTextContents();
    expect(names).toEqual(["planning", "plan b", "2026-10-24"]);
    await expect(popup.locator(".texto-wiki-suggest__footer")).toHaveText(
      "Type | to change display text",
    );
  });

  test("the query filters the candidates", async ({ page }) => {
    await typeTrigger(page);
    await page.keyboard.type("plan");
    await page.waitForTimeout(120);

    const names = await page
      .locator(".texto-wiki-suggest__name")
      .allTextContents();
    // tighter prefix (shorter name) first
    expect(names).toEqual(["plan b", "planning"]);
  });

  test("Enter accepts: inline syntax lands in the document, rendered as a link", async ({
    page,
  }) => {
    await typeTrigger(page);
    await page.keyboard.type("plann");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);

    await expect(page.locator(".texto-wiki-suggest")).toHaveCount(0);
    const doc = (await docJson(page)) as {
      content: { content?: { text?: string }[] }[];
    };
    // the document stores the raw inline syntax as plain text (no mark)
    expect(doc.content[1]!.content?.[0]?.text).toBe(
      "plain p1 see [[notes/planning.um]]",
    );
    // decorations render the target as the styled link label
    const link = page.locator(".texto-editor .ProseMirror .texto-wikilink");
    await expect(link).toHaveText("notes/planning.um");
  });

  test("«|» sets the display text; the label renders, syntax hides", async ({
    page,
  }) => {
    await typeTrigger(page);
    await page.keyboard.type("plan b|My Plan");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);

    const doc = (await docJson(page)) as {
      content: { content?: { text?: string }[] }[];
    };
    expect(doc.content[1]!.content?.[0]?.text).toBe(
      "plain p1 see [[notes/plan b.md|My Plan]]",
    );
    await expect(page.locator(".texto-editor .ProseMirror .texto-wikilink")).toHaveText(
      "My Plan",
    );
  });

  test("moving the caret inside reveals the raw syntax", async ({ page }) => {
    await typeTrigger(page);
    await page.keyboard.type("plann");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    await expect(page.locator(".texto-editor .ProseMirror .texto-wikilink")).toHaveText(
      "notes/planning.um",
    );

    // arrow left twice — the caret enters the pattern's range
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(150);
    await expect(page.locator(".texto-editor .ProseMirror .texto-wikilink")).toHaveCount(0);
    // and the raw text is there
    const doc = (await docJson(page)) as {
      content: { content?: { text?: string }[] }[];
    };
    expect(doc.content[1]!.content?.[0]?.text).toContain("[[notes/planning.um]]");
  });

  test("clicking a rendered link opens the target", async ({ page }) => {
    await page.evaluate(() => {
      window.__e2e.mount({
        type: "noteDoc",
        content: [
          { type: "noteTitle", content: [{ type: "text", text: "T" }] },
          { type: "paragraph", content: [{ type: "text", text: "go [[notes/planning.um]] now" }] },
        ],
      });
    });
    await page.waitForTimeout(150);

    const link = page.locator(".texto-editor .ProseMirror .texto-wikilink");
    await expect(link).toHaveText("notes/planning.um");
    await link.click();
    await page.waitForTimeout(100);

    const opens = await page.evaluate(() => window.__e2eWiki.opens);
    expect(opens).toEqual(["notes/planning.um"]);
  });

  test("unresolved target renders muted and the click does nothing", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.__e2e.mount({
        type: "noteDoc",
        content: [
          { type: "noteTitle", content: [{ type: "text", text: "T" }] },
          { type: "paragraph", content: [{ type: "text", text: "ghost [[nowhere/gone.md]] end" }] },
        ],
      });
    });
    await page.waitForTimeout(150);

    const link = page.locator(".texto-editor .ProseMirror .texto-wikilink");
    await expect(link).toHaveClass(/is-unresolved/);
    await link.click();
    await page.waitForTimeout(100);
    const opens = await page.evaluate(() => window.__e2eWiki.opens);
    expect(opens).toEqual([]);
  });
});
