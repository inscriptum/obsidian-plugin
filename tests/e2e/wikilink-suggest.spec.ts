import { expect, test } from "@playwright/test";
import { noteDoc, p } from "./fixtures/docs";
import { clickInsideText, docJson, mount, openHarness } from "./helpers";

const FILES = [
  { path: "notes/planning.um", name: "planning" },
  { path: "notes/plan b.md", name: "plan b" },
  { path: "daily/2026-10-24.md", name: "2026-10-24" },
];

test.describe("wiki-link «[[» suggest", () => {
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

  test("typing «[[» opens the popup with name and path", async ({ page }) => {
    await typeTrigger(page);

    const popup = page.locator(".texto-wiki-suggest");
    await expect(popup).toBeVisible();
    const names = await popup.locator(".texto-wiki-suggest__name").allTextContents();
    expect(names).toEqual(["planning", "plan b", "2026-10-24"]);
    const first = popup.locator(".texto-wiki-suggest__item").first();
    await expect(first.locator(".texto-wiki-suggest__path")).toHaveText(
      "notes/planning.um",
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

  test("Enter accepts: marked link inserted, popup closed", async ({ page }) => {
    await typeTrigger(page);
    await page.keyboard.type("plann");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(120);

    await expect(page.locator(".texto-wiki-suggest")).toHaveCount(0);
    const doc = (await docJson(page)) as {
      content: {
        type: string;
        content?: { text?: string; marks?: { type: string; attrs?: { path?: string } }[] }[];
      }[];
    };
    const para = doc.content[1]!;
    const marked = para.content?.find((r) => r.marks?.length);
    expect(marked?.marks?.[0]?.type).toBe("wikiLink");
    expect(marked?.marks?.[0]?.attrs?.path).toBe("notes/planning.um");
    expect(marked?.text).toBe("planning");
    // the unmarked prefix survived
    expect(para.content?.[0]?.text).toBe("plain p1 see ");
  });

  test("«|» sets the display text; the target stays in attrs", async ({
    page,
  }) => {
    await typeTrigger(page);
    await page.keyboard.type("plan b|My Plan");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(120);

    const doc = (await docJson(page)) as {
      content: {
        content?: { text?: string; marks?: { attrs?: { path?: string } }[] }[];
      }[];
    };
    const marked = doc.content[1]!.content?.find((r) => r.marks?.length);
    expect(marked?.text).toBe("My Plan");
    expect(marked?.marks?.[0]?.attrs?.path).toBe("notes/plan b.md");
  });

  test("Esc dismisses; typing a matching query reopens", async ({ page }) => {
    await typeTrigger(page);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);

    await expect(page.locator(".texto-wiki-suggest")).toHaveCount(0);
    const doc = (await docJson(page)) as {
      content: { content?: { text?: string }[] }[];
    };
    expect(doc.content[1]!.content?.[0]?.text).toBe("plain p1 see [[");
    // The dismissal lasts for this query: typing a MATCHING letter changes
    // the query and reopens the popup (the same semantics as Obsidian).
    await page.keyboard.type("plan");
    await page.waitForTimeout(120);
    await expect(page.locator(".texto-wiki-suggest")).toBeVisible();
    // Tab accepts too
    await page.keyboard.press("Tab");
    await page.waitForTimeout(120);
    const after = (await docJson(page)) as {
      content: { content?: { text?: string; marks?: { type: string }[] }[] }[];
    };
    expect(
      after.content[1]!.content?.some((r) => r.marks?.[0]?.type === "wikiLink"),
    ).toBe(true);
  });

  test("empty display after «|» falls back to the file name", async ({
    page,
  }) => {
    await typeTrigger(page);
    await page.keyboard.type("plann|");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(120);

    const doc = (await docJson(page)) as {
      content: { content?: { text?: string; marks?: { attrs?: { path?: string } }[] }[] }[];
    };
    const marked = doc.content[1]!.content?.find((r) => r.marks?.length);
    expect(marked?.text).toBe("planning");
    expect(marked?.marks?.[0]?.attrs?.path).toBe("notes/planning.um");
  });

  test("unresolved link renders muted and the click does nothing", async ({
    page,
  }) => {
    // a mark whose target is not in the fake vault
    await page.evaluate(() => {
      window.__e2e.mount({
        type: "noteDoc",
        content: [
          { type: "noteTitle", content: [{ type: "text", text: "T" }] },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "ghost",
                marks: [
                  { type: "wikiLink", attrs: { path: "nowhere/gone.md" } },
                ],
              },
            ],
          },
        ],
      });
    });
    await page.waitForTimeout(150);

    const link = page.locator(".texto-wikilink");
    await expect(link).toHaveClass(/is-unresolved/);
    await link.click();
    await page.waitForTimeout(100);
    const opens = await page.evaluate(() => window.__e2eWiki.opens);
    expect(opens).toEqual([]);
  });

  test("clicking an existing wikiLink opens the target", async ({ page }) => {
    // mount a doc that already carries a wikiLink mark
    await page.evaluate(() => {
      window.__e2e.mount({
        type: "noteDoc",
        content: [
          { type: "noteTitle", content: [{ type: "text", text: "T" }] },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "go " },
              {
                type: "text",
                text: "planning",
                marks: [
                  { type: "wikiLink", attrs: { path: "notes/planning.um" } },
                ],
              },
            ],
          },
        ],
      });
    });
    await page.waitForTimeout(150);

    const link = page.locator(".texto-wikilink");
    await expect(link).toHaveText("planning");
    await link.click();
    await page.waitForTimeout(100);

    const opens = await page.evaluate(() => window.__e2eWiki.opens);
    expect(opens).toEqual(["notes/planning.um"]);
  });
});
