import { expect, test, type Page } from "@playwright/test";
import { noteDoc, p, table } from "./fixtures/docs";
import {
  clickInsideText,
  docJson,
  mountToolbar,
  openHarness,
  textRange,
} from "./helpers";

const dock = ".menu-dock";
const panel = ".menu-dock__panel";

/** Click a dock group by its visible label (icon + label under it). */
async function openGroup(page: Page, label: string): Promise<void> {
  await page.locator(`${dock} .menu-dock__group`, { hasText: label }).click();
}

/** Click an action row inside the open panel by its accessible name —
 *  compact panels render icon-only buttons with labels in aria-label. */
async function clickAction(page: Page, label: string): Promise<void> {
  await page.locator(panel).getByRole("button", { name: label }).click();
}

/** Select the given text range via the editor API. */
async function selectText(
  page: Page,
  text: string,
): Promise<{ from: number; to: number }> {
  const range = await textRange(page, text);
  await page.evaluate(({ from, to }) => {
    const ed = window.__e2e.editor!;
    ed.view.focus();
    ed.commands.setTextSelection({ from, to });
  }, range);
  return range;
}

/** Select from the start of firstText to the end of lastText — spans
 *  several text nodes (marked runs) as one selection. */
async function selectSpan(
  page: Page,
  firstText: string,
  lastText: string,
): Promise<void> {
  const [from, to] = await Promise.all([
    textRange(page, firstText),
    textRange(page, lastText),
  ]);
  await page.evaluate(
    ({ from, to }) => {
      const ed = window.__e2e.editor!;
      ed.view.focus();
      ed.commands.setTextSelection({ from, to });
    },
    { from: from.from, to: to.to },
  );
}

async function clickInside(page: Page, text: string): Promise<void> {
  const para = page.locator(".texto-editor .ProseMirror > p", {
    hasText: text,
  });
  await clickInsideText(page, para, text, "end");
}

/** Caret into a table cell (its paragraphs are not `.ProseMirror > p`). */
async function clickCell(page: Page, text: string): Promise<void> {
  const cell = page
    .locator(".texto-editor td, .texto-editor th", { hasText: text })
    .first();
  await cell.click();
}

test.describe("mobile menu dock", () => {
  test("phone dock remains available with the keyboard closed", async ({
    page,
  }) => {
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("phone")));
    await page.locator(".note-toolbar-host").evaluate((host) => {
      const container = document.createElement("div");
      container.className = "note-view-container is-mobile is-phone";
      host.replaceWith(container);
      container.append(host);
    });
    await expect(page.locator(dock)).toBeVisible();
    await openGroup(page, "Text");
    await expect(page.locator(panel)).toBeVisible();
  });

  for (const view of ["note", "notepad"]) {
    test(`${view} dock clears the raised host navbar when the keyboard is hidden`, async ({
      page,
    }) => {
      await openHarness(page);
      await mountToolbar(page, noteDoc(p("phone")));
      await page.locator(".note-toolbar-host").evaluate((toolbar, view) => {
        const container = document.createElement("div");
        container.className = `${view}-view-container is-mobile is-phone`;
        container.style.cssText =
          "position:fixed;inset:0;display:flex;flex-direction:column;height:100%";
        toolbar.replaceWith(container);
        const spacer = document.createElement("div");
        spacer.style.flex = "1";
        container.append(spacer);
        if (view === "notepad") {
          const host = document.createElement("div");
          host.className = "notepad-toolbar-host";
          host.append(toolbar);
          container.append(host);
        } else container.append(toolbar);
        const navbar = document.createElement("div");
        navbar.className = "mobile-navbar mod-raised";
        navbar.style.cssText =
          "position:fixed;bottom:22px;left:0;right:0;height:52px;z-index:100";
        document.body.append(navbar);
      }, view);
      const row = page.locator(".menu-dock__row");
      const navbar = page.locator(".mobile-navbar.mod-raised");
      const rowBox = await row.boundingBox();
      const navBox = await navbar.boundingBox();
      expect(rowBox!.y + rowBox!.height).toBeLessThanOrEqual(navBox!.y);
      await page
        .locator(`${dock} .menu-dock__group`, { hasText: "Text" })
        .click();
      await expect(page.locator(panel)).toBeVisible();
      await page
        .locator(`.${view}-view-container`)
        .evaluate((el) => el.classList.add("is-keyboard-open"));
      const host = page.locator(
        view === "note" ? ".note-toolbar-host" : ".notepad-toolbar-host",
      );
      await expect(host).toHaveCSS("padding-bottom", "0px");
    });
  }

  test("long panel stays inside a container resized above the keyboard", async ({
    page,
  }) => {
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("phone"), table([["one", "two"]])));
    await page.locator(".texto-editor td, .texto-editor th").first().click();
    await page.locator(".note-toolbar-host").evaluate((host) => {
      const container = document.createElement("div");
      container.className =
        "note-view-container is-mobile is-phone is-keyboard-open";
      container.style.cssText =
        "position:fixed;top:0;left:0;right:0;height:300px;display:flex;flex-direction:column";
      host.replaceWith(container);
      const spacer = document.createElement("div");
      spacer.style.cssText = "flex:1;min-height:0";
      container.append(spacer, host);
      window.visualViewport?.dispatchEvent(new Event("resize"));
    });
    await openGroup(page, "Actions");
    const container = page.locator(".note-view-container");
    await expect
      .poll(async () => {
        const row = await page.locator(".menu-dock__row").boundingBox();
        const bounds = await container.boundingBox();
        return row && bounds
          ? row.y + row.height - (bounds.y + bounds.height)
          : Infinity;
      })
      .toBeLessThanOrEqual(1);
    expect(
      await page
        .locator(panel)
        .evaluate((el) => el.scrollHeight > el.clientHeight),
    ).toBe(true);
  });

  test("main context renders five groups and opens the block panel", async ({
    page,
  }) => {
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("plain p1")));

    await expect(page.locator(dock)).toBeVisible();

    const groups = page.locator(`${dock} .menu-dock__group`);
    await expect(groups).toHaveCount(5);
    await expect(
      page.getByRole("button", { name: "Hide keyboard" }),
    ).toHaveAttribute("aria-disabled", "true");

    await openGroup(page, "Text");
    await expect(page.locator(panel)).toBeVisible();
    await expect(
      page.locator(`${dock} .menu-dock__group`, { hasText: "Text" }),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(`${panel} .menu-dock__action`)).toHaveCount(5);
  });

  test("repeated group tap dismisses its panel", async ({ page }) => {
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("plain")));
    await openGroup(page, "Text");
    await openGroup(page, "Text");
    await expect(page.locator(panel)).toHaveCount(0);

    await expect(
      page.locator(`${dock} .menu-dock__group`, { hasText: "Text" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  test("hide keyboard blurs a focused link field", async ({ page }) => {
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("plain")));
    await openGroup(page, "Insert");
    await clickAction(page, "Link");
    const input = page.getByRole("textbox", { name: "Link URL" });
    await input.focus();
    await page.evaluate(() => {
      document.body.classList.add("is-mobile");
      document.documentElement.style.setProperty("--keyboard-height", "300px");
    });
    const hide = page.getByRole("button", { name: "Hide keyboard" });
    await expect(hide).toHaveAttribute("aria-disabled", "false");
    await hide.click();
    await expect(input).not.toBeFocused();
  });

  test("block style applies to the current block without any selection", async ({
    page,
  }) => {
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("plain p1")));
    await clickInside(page, "plain p1");

    await openGroup(page, "Text");
    await clickAction(page, "Heading 1");

    const json = await docJson(page);
    const first = json.content?.[1] as JsonLike;
    expect(first.type).toBe("heading");
    expect(first.attrs?.level).toBe(1);
  });

  test("text selection: the main row carries Bold, Italic, Highlight, Style, More", async ({
    page,
  }) => {
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("alpha bravo charlie")));
    await selectText(page, "alpha bravo charlie");

    const groups = page.locator(`${dock} .menu-dock__group`);
    await expect(groups).toHaveCount(5);
    await expect(page.getByRole("button", { name: "Bold" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Italic" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Highlight", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Styles and color" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "More actions" }),
    ).toBeVisible();
    // No Format group anymore: the frequent marks are direct.
    await expect(page.locator(dock)).not.toContainText("Format");
  });

  test("Bold toggles straight from the group row", async ({ page }) => {
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("alpha bravo charlie")));
    await selectText(page, "alpha bravo charlie");

    const bold = page.getByRole("button", { name: "Bold" });
    await expect(bold).toHaveAttribute("aria-pressed", "false");
    await bold.click();
    await expect(bold).toHaveAttribute("aria-pressed", "true");
    await expect(bold).toHaveClass(/is-active/);
    let json = await docJson(page);
    expect(
      findText(json, "alpha bravo charlie")?.marks?.some(
        (m) => m.type === "bold",
      ),
    ).toBe(true);

    await bold.click();
    await expect(bold).toHaveAttribute("aria-pressed", "false");
    json = await docJson(page);
    expect(
      findText(json, "alpha bravo charlie")?.marks?.some(
        (m) => m.type === "bold",
      ),
    ).not.toBe(true);
  });

  test("bold next to inline code shows the toggle direction, not mixed", async ({
    page,
  }) => {
    await openHarness(page);
    await mountToolbar(
      page,
      noteDoc({
        type: "paragraph",
        content: [
          { type: "text", text: "alpha", marks: [{ type: "bold" }] },
          { type: "text", text: " bravo", marks: [{ type: "code" }] },
        ],
      }),
    );
    await selectSpan(page, "alpha", " bravo");

    // Inline code cannot carry bold, so the toggle counts that run as
    // covered: the button reads pressed and one tap REMOVES the mark.
    const bold = page.getByRole("button", { name: "Bold" });
    await expect(bold).toHaveAttribute("aria-pressed", "true");
    await expect(bold).toHaveClass(/is-active/);
    await expect(bold).not.toHaveClass(/is-mixed/);

    await bold.click();
    await expect(bold).toHaveAttribute("aria-pressed", "false");
    const json = await docJson(page);
    expect(
      findText(json, "alpha")?.marks?.some((m) => m.type === "bold"),
    ).not.toBe(true);
    // The exclusive code mark survives the toggle untouched.
    expect(findText(json, "bravo")?.marks?.some((m) => m.type === "code")).toBe(
      true,
    );
  });

  test("Italic toggles straight from the group row", async ({ page }) => {
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("alpha bravo charlie")));
    await selectText(page, "alpha bravo charlie");

    const italic = page.getByRole("button", { name: "Italic" });
    await expect(italic).toHaveAttribute("aria-pressed", "false");
    await italic.click();
    await expect(italic).toHaveAttribute("aria-pressed", "true");
    const json = await docJson(page);
    expect(
      findText(json, "alpha bravo charlie")?.marks?.some(
        (m) => m.type === "italic",
      ),
    ).toBe(true);
  });

  test("a partly formatted selection reports mixed and paints the whole range", async ({
    page,
  }) => {
    await openHarness(page);
    await mountToolbar(
      page,
      noteDoc({
        type: "paragraph",
        content: [
          { type: "text", text: "alpha", marks: [{ type: "bold" }] },
          { type: "text", text: " bravo" },
        ],
      }),
    );
    await selectSpan(page, "alpha", " bravo");

    const bold = page.getByRole("button", { name: "Bold" });
    // Tri-state toggle: a mixed selection is neither on nor off (EO 3).
    await expect(bold).toHaveAttribute("aria-pressed", "mixed");
    await expect(bold).toHaveClass(/is-mixed/);

    // One tap resolves the mixed state across the whole selection.
    await bold.click();
    await expect(bold).toHaveAttribute("aria-pressed", "true");
    const json = await docJson(page);
    expect(findText(json, "alpha")?.marks?.some((m) => m.type === "bold")).toBe(
      true,
    );
    expect(findText(json, "bravo")?.marks?.some((m) => m.type === "bold")).toBe(
      true,
    );
  });

  test("Link in More reports the mark tri-state", async ({
    page,
  }) => {
    await openHarness(page);
    await mountToolbar(
      page,
      noteDoc({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "alpha",
            marks: [{ type: "link", attrs: { href: "https://example.com" } }],
          },
          { type: "text", text: " bravo" },
        ],
      }),
    );

    await selectSpan(page, "alpha", " bravo");
    await openGroup(page, "More");
    const link = page.locator(panel).getByRole("button", { name: "Link", exact: true });
    // A partly linked selection is neither on nor off, but the button still
    // opens the link panel (aria-expanded stays).
    await expect(link).toHaveAttribute("aria-pressed", "mixed");
    await expect(link).toHaveClass(/is-mixed/);

    // Fully linked selection: steady on-state.
    await openGroup(page, "More");
    await selectText(page, "alpha");
    await openGroup(page, "More");
    await expect(link).toHaveAttribute("aria-pressed", "true");
    await expect(link).toHaveClass(/is-active/);
    await expect(link).not.toHaveClass(/is-mixed/);
  });

  test("More collects the remaining format actions and Clear formatting", async ({
    page,
  }) => {
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("alpha bravo charlie")));
    await selectText(page, "alpha bravo charlie");

    await openGroup(page, "More");
    for (const name of [
      "Underline",
      "Strikethrough",
      "Inline code",
      "Link",
      "Clear formatting",
    ]) {
      await expect(
        page.locator(panel).getByRole("button", { name }),
      ).toBeVisible();
    }
  });

  test("highlight menu remembers the chosen color and can restore default", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("alpha bravo")));
    const full = await textRange(page, "alpha bravo");
    await page.evaluate(({ from }) => { const ed = window.__e2e.editor!; ed.view.focus(); ed.commands.setTextSelection({ from, to: from + 5 }); }, full);
    await page.getByRole("button", { name: "Highlight", exact: true }).click();
    await expect(page.locator(panel)).toHaveAttribute("aria-label", "Highlight color");
    const palette = page.locator(".menu-dock__swatches--highlight .menu-dock__swatch");
    await expect(palette).toHaveCount(8);
    await expect(palette.first()).toHaveAttribute("aria-label", "Remove highlight");
    const positions = await palette.evaluateAll((buttons) => buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { x: rect.x, y: rect.y, right: rect.right };
    }));
    expect(new Set(positions.map((rect) => rect.y)).size).toBe(1);
    expect(positions.every((rect, i) => (i === 0 || rect.x >= positions[i - 1]!.right) && rect.x >= 0 && rect.right <= 320), JSON.stringify(positions)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.activeElement === window.__e2e.editor!.view.dom)).toBe(true);
    await expect(page.locator(".ProseMirror mark")).toHaveCount(1);
    await clickAction(page, "Blue highlight");
    await expect(page.locator(".ProseMirror mark")).toHaveAttribute("data-color", "rgba(8, 109, 221, 0.3)");
    await page.evaluate(({ from }) => { const ed = window.__e2e.editor!; ed.view.focus(); ed.commands.setTextSelection({ from: from + 6, to: from + 11 }); }, full);
    await page.getByRole("button", { name: "Highlight", exact: true }).click();
    await expect(page.locator(".ProseMirror mark").last()).toHaveAttribute("data-color", "rgba(8, 109, 221, 0.3)");
    await clickAction(page, "Default highlight");
    await expect(page.locator(".ProseMirror mark").last()).not.toHaveAttribute("data-color");
  });

  test("a More panel toggle resolves a mixed mark across the whole range", async ({
    page,
  }) => {
    await openHarness(page);
    await mountToolbar(
      page,
      noteDoc({
        type: "paragraph",
        content: [
          { type: "text", text: "alpha", marks: [{ type: "underline" }] },
          { type: "text", text: " bravo" },
        ],
      }),
    );
    await selectSpan(page, "alpha", " bravo");
    await openGroup(page, "More");

    const underline = page
      .locator(panel)
      .getByRole("button", { name: "Underline" });
    await expect(underline).toHaveAttribute("aria-pressed", "mixed");
    await expect(underline).toHaveClass(/is-mixed/);

    // One tap paints the whole held selection.
    await underline.click();
    await expect(underline).toHaveAttribute("aria-pressed", "true");
    const json = await docJson(page);
    expect(
      findText(json, "alpha")?.marks?.some((m) => m.type === "underline"),
    ).toBe(true);
    expect(
      findText(json, "bravo")?.marks?.some((m) => m.type === "underline"),
    ).toBe(true);
  });

  test("a mixed color selection is not reported as one color", async ({
    page,
  }) => {
    await openHarness(page);
    await mountToolbar(
      page,
      noteDoc({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "alpha",
            marks: [{ type: "textStyle", attrs: { color: "#b3a3f7" } }],
          },
          { type: "text", text: " bravo" },
        ],
      }),
    );
    await selectSpan(page, "alpha", " bravo");
    await openGroup(page, "Style");

    // No swatch counts as active: the selection holds two distinct colors.
    await expect(
      page.locator(`${panel} .menu-dock__swatch.is-active`),
    ).toHaveCount(0);
    await expect(page.locator(`${panel} .bb-dd-hex`)).toHaveValue("");
  });

  for (const [width, height] of [
    [360, 740],
    [390, 740],
    [430, 740],
    [320, 568],
  ] as const) {
    test(`table panels are compact: half the viewport, scroll reaches the last row (${width}x${height})`, async ({
      page,
    }) => {
      await openHarness(page);
      await page.setViewportSize({ width, height });
      await mountToolbar(
        page,
        noteDoc(
          p("before"),
          table([
            ["alpha", "bravo"],
            ["charlie", "delta"],
          ]),
        ),
      );
      // Phone viewport wrapper: the cap formula reads the container height.
      await page.locator(".note-toolbar-host").evaluate((host) => {
        const container = document.createElement("div");
        container.className = "note-view-container is-mobile is-phone";
        container.style.cssText =
          "position:fixed;inset:0;display:flex;flex-direction:column;height:100%;pointer-events:none";
        host.replaceWith(container);
        const spacer = document.createElement("div");
        spacer.style.cssText = "flex:1;min-height:0;pointer-events:none";
        host.style.pointerEvents = "auto";
        container.append(spacer, host);
        window.visualViewport?.dispatchEvent(new Event("resize"));
      });
      await clickCell(page, "alpha");
      await openGroup(page, "Actions");

      const container = await page
        .locator(".note-view-container")
        .boundingBox();
      const panelBox = await page.locator(panel).boundingBox();
      expect(container).not.toBeNull();
      expect(panelBox).not.toBeNull();
      // EO 2: the open panel keeps roughly half of the container for the doc.
      expect(panelBox!.height).toBeLessThanOrEqual(container!.height * 0.5);

      // Every command stays reachable: scrolling brings the last row into view.
      const deleteTable = page
        .locator(panel)
        .getByRole("button", { name: "Delete table" });
      await deleteTable.scrollIntoViewIfNeeded();
      await expect(deleteTable).toBeVisible();
      await expect(deleteTable).toHaveAttribute("aria-label", /Delete table/);

      // 44dp touch targets even in the icon grid (EO 2), incl. the 320px phone.
      const sizes = await page
        .locator(`${panel} .menu-dock__action--icon`)
        .evaluateAll((els) =>
          els.map((el) => {
            const r = el.getBoundingClientRect();
            return { w: r.width, h: r.height };
          }),
        );
      expect(sizes.length).toBeGreaterThan(0);
      for (const s of sizes) {
        expect(s.w).toBeGreaterThanOrEqual(43.9);
        expect(s.h).toBeGreaterThanOrEqual(43.9);
      }

      // The cap really binds when the content exceeds it: the Borders panel
      // (pen row + palette + 9 border commands) is taller than 45% of the
      // container, so it is clamped to the cap and still scrolls to its
      // last row.
      await openGroup(page, "Borders");
      const clamped = await page.locator(panel).evaluate((el) => {
        const cs = getComputedStyle(el);
        const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        const border =
          parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
        // clientHeight includes padding, excludes borders; the cap applies
        // to the content box (content-box) or the border box (border-box).
        const expected =
          cs.boxSizing === "border-box"
            ? parseFloat(cs.maxHeight) - border
            : parseFloat(cs.maxHeight) + pad;
        // Pin the 45% coefficient itself: A is the available height the
        // formula reads (container here, no keyboard), so shrinking the
        // coefficient must fail this assert, not only growing it.
        const container = el.closest(
          ".note-view-container, .notepad-view-container",
        );
        const available = Math.min(
          container?.getBoundingClientRect().height ?? Number.POSITIVE_INFINITY,
          window.visualViewport?.height ?? window.innerHeight,
        );
        return {
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          expected,
          maxHeight: parseFloat(cs.maxHeight),
          coefficientCap: Math.round(available * 0.45),
        };
      });
      expect(clamped.scrollHeight).toBeGreaterThan(clamped.clientHeight);
      expect(
        Math.abs(clamped.clientHeight - clamped.expected),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(clamped.maxHeight - clamped.coefficientCap),
      ).toBeLessThanOrEqual(1);

      const leftBorder = page
        .locator(panel)
        .getByRole("button", { name: "Left border" });
      await leftBorder.scrollIntoViewIfNeeded();
      await expect(leftBorder).toBeVisible();
      const reachable = await leftBorder.evaluate((el) => {
        const panelRect = el
          .closest(".menu-dock__panel")!
          .getBoundingClientRect();
        const box = el.getBoundingClientRect();
        return (
          box.top >= panelRect.top &&
          box.bottom <= panelRect.bottom &&
          box.left >= panelRect.left &&
          box.right <= panelRect.right
        );
      });
      expect(reachable).toBe(true);

      // Leave no panel open.
      await openGroup(page, "Borders");
      await expect(page.locator(panel)).toHaveCount(0);
    });
  }

  test("the 200px floor binds the panel on a short container", async ({
    page,
  }) => {
    await openHarness(page);
    await page.setViewportSize({ width: 360, height: 740 });
    await mountToolbar(
      page,
      noteDoc(
        p("before"),
        table([
          ["alpha", "bravo"],
          ["charlie", "delta"],
        ]),
      ),
    );
    // Same wrapper, but the container is short: 0.45 × 420 = 189 falls under
    // the 200px floor, and the absolute cap (420 − 132 = 288) stays above it.
    await page.locator(".note-toolbar-host").evaluate((host) => {
      const container = document.createElement("div");
      container.className = "note-view-container is-mobile is-phone";
      container.style.cssText =
        "position:fixed;top:0;left:0;right:0;height:420px;display:flex;flex-direction:column;pointer-events:none";
      host.replaceWith(container);
      const spacer = document.createElement("div");
      spacer.style.cssText = "flex:1;min-height:0;pointer-events:none";
      host.style.pointerEvents = "auto";
      container.append(spacer, host);
      window.visualViewport?.dispatchEvent(new Event("resize"));
    });
    // The container height var is set by an async ResizeObserver — wait for
    // it so the measurement never races the observer.
    await expect
      .poll(() =>
        page
          .locator(".menu-dock-host")
          .evaluate((el) =>
            el.style.getPropertyValue("--dock-container-height"),
          ),
      )
      .toBe("420px");
    await clickCell(page, "alpha");
    await openGroup(page, "Actions");

    const floorBox = await page.locator(panel).evaluate((el) => {
      const cs = getComputedStyle(el);
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const border =
        parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      // Used height in the box model the cap formula applies to.
      const used =
        cs.boxSizing === "border-box"
          ? el.clientHeight + border
          : el.clientHeight - pad;
      return {
        used,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
      };
    });
    // The floor binds: the panel sits at ~200px (not 189) and the Actions
    // content still scrolls inside it.
    expect(Math.abs(floorBox.used - 200)).toBeLessThanOrEqual(2);
    expect(floorBox.scrollHeight).toBeGreaterThan(floorBox.clientHeight);

    // Leave no panel open.
    await openGroup(page, "Actions");
    await expect(page.locator(panel)).toHaveCount(0);
  });

  test("danger commands sit at the bottom of the table panel", async ({
    page,
  }) => {
    await openHarness(page);
    await mountToolbar(
      page,
      noteDoc(
        p("before"),
        table([
          ["alpha", "bravo"],
          ["charlie", "delta"],
        ]),
      ),
    );
    await clickCell(page, "alpha");
    await openGroup(page, "Actions");

    const tops = await page
      .locator(`${panel} .menu-dock__action`)
      .evaluateAll((els) =>
        els.map((el) => ({
          name: el.getAttribute("aria-label") ?? "",
          danger: el.classList.contains("is-danger"),
          y: el.getBoundingClientRect().y,
        })),
      );
    const firstDanger = tops.findIndex((t) => t.name.startsWith("Delete"));
    expect(firstDanger).toBeGreaterThan(0);
    for (let i = 0; i < firstDanger; i += 1) {
      expect(tops[i].y).toBeLessThan(tops[firstDanger].y);
    }
    // Symmetry: the bottom-most command is itself a danger one.
    const bottom = tops.reduce((a, b) => (b.y >= a.y ? b : a));
    expect(bottom.name.startsWith("Delete")).toBe(true);
    expect(bottom.danger).toBe(true);
  });

  test("Style panel paints a palette color and offers the custom row", async ({
    page,
  }) => {
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("alpha bravo charlie")));
    const range = await textRange(page, "alpha bravo charlie");
    await page.evaluate(({ from, to }) => {
      const ed = window.__e2e.editor!;
      ed.view.focus();
      ed.commands.setTextSelection({ from, to });
    }, range);
    await openGroup(page, "Style");

    // The styles panel keeps the text-color palette and custom color row.
    await expect(
      page.locator(
        `${panel} .menu-dock__swatches:not(.menu-dock__swatches--highlight) .menu-dock__swatch`,
      ),
    ).toHaveCount(12);
    await expect(
      page.locator(`${panel} .menu-dock__swatches--highlight .menu-dock__swatch`),
    ).toHaveCount(0);
    await expect(page.locator(`${panel} .bb-dd-custom`)).toHaveCount(1);

    await page.locator(`${panel} .menu-dock__swatch[title="Purple"]`).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.activeElement === window.__e2e.editor!.view.dom,
        ),
      )
      .toBe(false);
    await expect(
      page.locator(`${panel} .menu-dock__swatch[title="Purple"]`),
    ).toHaveAttribute("aria-pressed", "true");
    const json = await docJson(page);
    const text = findText(json, "alpha");
    const color = text?.marks?.find((m) => m.type === "textStyle")?.attrs
      ?.color;
    expect(color).toBe("#b3a3f7");
  });

  test("table context: fill paints the cell; merge explains why it is off", async ({
    page,
  }) => {
    await openHarness(page);
    await mountToolbar(
      page,
      noteDoc(
        p("before"),
        table([
          ["alpha", "bravo"],
          ["charlie", "delta"],
        ]),
      ),
    );
    // Caret into the first cell → table context.
    await clickCell(page, "alpha");

    await expect(page.locator(`${dock} .menu-dock__group`)).toHaveCount(4);

    await openGroup(page, "Fill");
    await page.locator(`${panel} .menu-dock__swatch[title="Purple"]`).click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const ed = window.__e2e.editor!;
          let attr: string | null | undefined = null;
          ed.state.doc.descendants((n) => {
            if (
              (n.type.name === "tableHeader" || n.type.name === "tableCell") &&
              n.textContent === "alpha"
            )
              attr = n.attrs?.backgroundColor ?? null;
            return true;
          });
          return attr;
        }),
      )
      .toBe("rgba(179, 163, 247, .16)");

    await openGroup(page, "Actions");
    const merge = page
      .locator(panel)
      .getByRole("button", { name: "Merge cells" });
    // Review F37: the unavailable command stays in the DOM and explains
    // itself, instead of a silent native disabled.
    await expect(merge).toHaveAttribute("aria-disabled", "true");
    await expect(merge).toHaveAttribute(
      "aria-label",
      /Select a valid range of cells/,
    );
    // Split is off for a non-merged cell.
    await expect(
      page.locator(panel).getByRole("button", { name: "Split cell" }),
    ).toHaveAttribute("aria-disabled", "true");
    // Header works from the same panel: the fixture row is a header row, so
    // the toggle flips its cells to regular cells.
    await clickAction(page, "Table header");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const ed = window.__e2e.editor!;
          const names: string[] = [];
          ed.state.doc.descendants((n) => {
            if (n.type.name.startsWith("table")) {
              if (/cell/i.test(n.type.name)) names.push(n.type.name);
            }
            return true;
          });
          return names[0] ?? null;
        }),
      )
      .toBe("tableCell");
  });

  test("Done closes the panel and leaves the table context", async ({
    page,
  }) => {
    await openHarness(page);
    await mountToolbar(
      page,
      noteDoc(
        p("before"),
        table([
          ["alpha", "bravo"],
          ["charlie", "delta"],
        ]),
      ),
    );
    await clickCell(page, "alpha");
    await openGroup(page, "Fill");
    await expect(page.locator(panel)).toBeVisible();

    await openGroup(page, "Done");
    await expect(page.locator(panel)).toHaveCount(0);
  });

  test("merge then split work straight from the Actions panel", async ({
    page,
  }) => {
    await openHarness(page);
    await mountToolbar(
      page,
      noteDoc(
        p("before"),
        table([
          ["alpha", "bravo"],
          ["charlie", "delta"],
        ]),
      ),
    );
    // Cell selection over the two header cells → the context is table.
    await page.evaluate(() => {
      const ed = window.__e2e.editor!;
      const positions: number[] = [];
      ed.state.doc.descendants((node, pos) => {
        if (node.type.name === "tableHeader" || node.type.name === "tableCell")
          positions.push(pos);
        return true;
      });
      ed.view.focus();
      ed.chain()
        .setCellSelection({ anchorCell: positions[0], headCell: positions[1] })
        .run();
    });
    await openGroup(page, "Actions");

    const merge = page
      .locator(panel)
      .getByRole("button", { name: "Merge cells" });
    await expect(merge).not.toHaveAttribute("aria-disabled", "true");
    await merge.click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const ed = window.__e2e.editor!;
          let merged = false;
          ed.state.doc.descendants((node) => {
            if (node.type.name === "tableHeader" && node.attrs.colspan === 2)
              merged = true;
            return true;
          });
          return merged;
        }),
      )
      .toBe(true);

    // Split is enabled on the merged cell and undoes the merge.
    const split = page
      .locator(panel)
      .getByRole("button", { name: "Split cell" });
    await expect(split).not.toHaveAttribute("aria-disabled", "true");
    await split.click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const ed = window.__e2e.editor!;
          let colspan = 0;
          ed.state.doc.descendants((node) => {
            if (node.type.name === "tableHeader")
              colspan = Math.max(colspan, node.attrs.colspan ?? 1);
            return true;
          });
          return colspan;
        }),
      )
      .toBe(1);
  });

  test("tapping the document closes the panel in every context", async ({
    page,
  }) => {
    await openHarness(page);
    await mountToolbar(
      page,
      noteDoc(p("before"), table([["alpha", "bravo"]]), p("after")),
    );

    // Text context: More open → tap in the doc → back to editing.
    const range = await textRange(page, "before");
    await page.evaluate(({ from, to }) => {
      const ed = window.__e2e.editor!;
      ed.view.focus();
      ed.chain().setTextSelection({ from, to }).run();
    }, range);
    await expect(
      page.getByRole("button", { name: "More actions" }),
    ).toBeVisible();
    await openGroup(page, "More");
    await expect(page.locator(panel)).toBeVisible();
    await page.locator(".texto-editor p", { hasText: "after" }).click();
    await expect(page.locator(panel)).toHaveCount(0);
    // Back to editing, not just a closed panel: the main row is back.
    await expect(page.locator(`${dock} .menu-dock__group`)).toHaveCount(5);

    // Table context: same contract.
    await clickCell(page, "alpha");
    await openGroup(page, "Actions");
    await expect(page.locator(panel)).toBeVisible();
    await page.locator(".texto-editor p", { hasText: "after" }).click();
    await expect(page.locator(panel)).toHaveCount(0);
    await expect(page.locator(`${dock} .menu-dock__group`)).toHaveCount(5);
  });

  test("re-tapping the open group closes the panel in table and text contexts", async ({
    page,
  }) => {
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("before"), table([["alpha", "bravo"]])));
    await clickCell(page, "alpha");
    await openGroup(page, "Actions");
    await expect(page.locator(panel)).toBeVisible();
    await openGroup(page, "Actions");
    await expect(page.locator(panel)).toHaveCount(0);

    const range = await textRange(page, "alpha");
    await page.evaluate(({ from, to }) => {
      const ed = window.__e2e.editor!;
      ed.view.focus();
      ed.chain().setTextSelection({ from, to }).run();
    }, range);
    await openGroup(page, "Style");
    await expect(page.locator(panel)).toBeVisible();
    await openGroup(page, "Style");
    await expect(page.locator(panel)).toHaveCount(0);
  });

  test.describe("coarse custom colors", () => {
    test.use({ hasTouch: true, viewport: { width: 1000, height: 800 } });

    test("the custom color popup opens from the dock and applies a shade", async ({
      page,
    }) => {
      await openHarness(page);
      await mountToolbar(page, noteDoc(p("alpha bravo charlie")));
      const range = await textRange(page, "alpha bravo charlie");
      await page.evaluate(({ from, to }) => {
        const ed = window.__e2e.editor!;
        ed.view.focus();
        ed.commands.setTextSelection({ from, to });
      }, range);
      await openGroup(page, "Style");
      await page.locator(`${panel} .bb-dd-open`).click();
      const popup = page.locator(".bb-dd-popup.show");
      await expect(popup).toBeVisible();

      const color = await popup
        .locator(".bb-sw")
        .nth(20)
        .evaluate((el) => (el as HTMLElement).style.backgroundColor);
      await popup.locator(".bb-sw").nth(20).tap();
      await expect(popup).toHaveCount(0);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const ed = window.__e2e.editor!;
            return ed.view.dom.querySelector<HTMLElement>(
              "span[style*='color']",
            )?.style.color;
          }),
        )
        .toBe(color);
    });
  });

  test("a context switch closes the open panel", async ({ page }) => {
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("alpha bravo charlie")));
    // Caret → main context → Text group opens the block panel.
    await clickInside(page, "alpha bravo charlie");
    await openGroup(page, "Text");
    await expect(page.locator(panel)).toBeVisible();

    // A text selection switches the context — the panel must close with it.
    const range = await textRange(page, "alpha bravo charlie");
    await page.evaluate(({ from, to }) => {
      const ed = window.__e2e.editor!;
      ed.commands.setTextSelection({ from, to });
    }, range);
    await expect(page.locator(panel)).toHaveCount(0);
  });
});

interface JsonLike {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: JsonLike[];
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

function findText(node: JsonLike | undefined, needle: string): JsonLike | null {
  if (node == null) return null;
  if (node.text?.includes(needle)) return node;
  for (const child of node.content ?? []) {
    const hit = findText(child, needle);
    if (hit) return hit;
  }
  return null;
}

async function cellAttr(
  page: Page,
  attr: string,
): Promise<string | null | undefined> {
  return page.evaluate((a) => {
    const ed = window.__e2e.editor!;
    const $from = ed.state.selection.$from;
    let depth = $from.depth;
    while (depth > 0) {
      const node = $from.node(depth);
      if (node.type.name === "table_cell" || node.type.name === "table_header")
        return node.attrs?.[a] ?? null;
      depth -= 1;
    }
    return null;
  }, attr);
}
