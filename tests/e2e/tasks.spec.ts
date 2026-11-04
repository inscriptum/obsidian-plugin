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

  // Issue task-item-theme: the default checkbox is an inline SVG driven by
  // theme tokens, with a draw-in checkmark and a box pop on check.
  test("default checkbox follows theme tokens and animates the checkmark", async ({
    page,
  }) => {
    // Headless CI reports prefers-reduced-motion: reduce by default —
    // which turns the pop animation off — so the animation expectations
    // below need the explicit no-preference emulation.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openHarness(page);
    await mount(page, noteDoc(taskList([{ text: "todo tokens" }])));

    const host = page.locator(`${EDITOR} .texto-extension-task-item-host`, {
      hasText: "todo tokens",
    });

    // Inline default checkbox (no <use> sprite reference).
    await expect(host.locator("svg.texto-task-check")).toHaveCount(1);
    await expect(host.locator(".custom-icon use")).toHaveCount(0);

    const unchecked = await page.evaluate(() => {
      const box = document.querySelector(".texto-task-check__box");
      const mark = document.querySelector(".texto-task-check__mark");
      if (box == null || mark == null) return null;
      const bs = getComputedStyle(box);
      const ms = getComputedStyle(mark);
      return {
        boxStroke: bs.stroke,
        markOffset: Number.parseFloat(ms.strokeDashoffset),
      };
    });
    expect(unchecked).not.toBeNull();
    // Unchecked border is a text-normal mix at 30% (color-mix serializes
    // as color(srgb … / 0.3)) — not the old hardcoded gray.
    expect(unchecked?.boxStroke).toMatch(/^color\(srgb .+ \/ 0\.3\)$/);
    // The mark hides behind the dash gap while unchecked.
    expect(unchecked?.markOffset).toBeGreaterThan(0);

    await host.locator("label").click();
    // The pop animation runs right after the check. The received object
    // (shown in full on failure) carries the state needed to triage the
    // CI-only failure: class, media emulation, checked attr, counts.
    const animation = await page.evaluate(() => {
      const svg = document.querySelector(".texto-task-check");
      return {
        anim: svg == null ? null : getComputedStyle(svg).animationName,
        cls: svg?.getAttribute("class") ?? null,
        svgCount: document.querySelectorAll(".texto-task-check").length,
        hostCount: document.querySelectorAll(
          ".texto-extension-task-item-host",
        ).length,
        checked:
          document
            .querySelector(".texto-extension-task-item-host")
            ?.getAttribute("data-checked") ?? null,
        reduce: matchMedia("(prefers-reduced-motion: reduce)").matches,
        noPref: matchMedia("(prefers-reduced-motion: no-preference)").matches,
        inputChecked:
          document
            .querySelector(".texto-extension-task-item-host input")
            ?.checked ?? null,
        inputClass:
          document
            .querySelector(".texto-extension-task-item-host input")
            ?.className ?? null,
      };
    });
    expect(animation).toEqual({ anim: "texto-task-check-pop" });

    await expect
      .poll(() =>
        page.evaluate(() => {
          const box = document.querySelector(".texto-task-check__box");
          const mark = document.querySelector(".texto-task-check__mark");
          if (box == null || mark == null) return null;
          const bs = getComputedStyle(box);
          const ms = getComputedStyle(mark);
          return {
            boxFill: bs.fill,
            markStroke: ms.stroke,
            markOffset: Number.parseFloat(ms.strokeDashoffset),
          };
        }),
      )
      .toMatchObject({ markOffset: 0 });

    const checked = await page.evaluate(() => {
      const box = document.querySelector(".texto-task-check__box");
      const mark = document.querySelector(".texto-task-check__mark");
      if (box == null || mark == null) return null;
      return {
        boxFill: getComputedStyle(box).fill,
        boxStroke: getComputedStyle(box).stroke,
        markStroke: getComputedStyle(mark).stroke,
      };
    });
    // Checked box is a note-accent mix (14% fill, 55% stroke), the mark is
    // the accent text token — positive assertions on the color-mix forms.
    expect(checked?.boxFill).toMatch(/^color\(srgb .+ \/ 0\.14\)$/);
    expect(checked?.boxStroke).toMatch(/^color\(srgb .+ \/ 0\.55\)$/);
    expect(checked?.markStroke).toMatch(/^rgb\(/);
  });

  test("reduced motion: no pop animation, instant mark", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHarness(page);
    await mount(page, noteDoc(taskList([{ text: "todo calm" }])));

    const host = page.locator(`${EDITOR} .texto-extension-task-item-host`, {
      hasText: "todo calm",
    });
    await host.locator("label").click();

    await expect
      .poll(() =>
        page.evaluate(() => {
          const svg = document.querySelector(".texto-task-check");
          const mark = document.querySelector(".texto-task-check__mark");
          if (svg == null || mark == null) return null;
          return {
            animation: getComputedStyle(svg).animationName,
            offset: Number.parseFloat(getComputedStyle(mark).strokeDashoffset),
          };
        }),
      )
      .toMatchObject({ animation: "none", offset: 0 });
  });
});
