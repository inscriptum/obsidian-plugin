import { expect, test } from "@playwright/test";
import { openHarness } from "./helpers";

interface ExportPayload {
  folder: string;
  result: {
    missingImages: string[];
    removedAttachments: number;
    droppedDiagrams: number;
    skippedPages: number;
  };
  files: Record<string, string>;
}

/** The harness API returns every captured file base64 (utf-8 first). */
function decodeB64(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

test.describe("notepad website export", () => {
  test("exports pages, packed assets and a mermaid SVG file", async ({
    page,
  }) => {
    await openHarness(page);
    const payload = await page.evaluate(async (): Promise<ExportPayload> => {
      const api = (
        window as unknown as {
          __e2eExport: {
            exportUmWebsite: (spec: unknown) => Promise<ExportPayload>;
          };
        }
      ).__e2eExport;
      return api.exportUmWebsite({
        title: "E2E export",
        summary: "smoke summary",
        assets: [
          { bytesB64: btoa("png-bytes"), filename: "pic.png", mime: "image/png" },
        ],
        pages: [
          {
            type: "noteDoc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "first page" }],
              },
              {
                type: "image",
                attrs: { data: { id: "asset:0", filename: "pic.png" } },
              },
            ],
          },
          {
            type: "noteDoc",
            content: [
              { type: "mermaid", attrs: { code: "graph TD\nA --> B" } },
            ],
          },
        ],
      });
    });

    expect(payload.result.droppedDiagrams).toBe(0);
    expect(payload.result.skippedPages).toBe(0);
    expect(payload.folder).toBe("export/E2E-export");

    const index = decodeB64(payload.files["export/E2E-export/index.html"]);
    expect(index).toContain("<title>E2E export</title>");
    expect(index).toContain("first page");
    expect(index).toContain('src="images/image-1.png"');
    // the diagram compiled through the REAL mermaid engine in this browser
    expect(index).toContain('src="images/diagram-1.svg"');
    expect(index).not.toContain("texto-extension-mermaid");
    const diagram = decodeB64(
      payload.files["export/E2E-export/images/diagram-1.svg"],
    );
    expect(diagram).toContain("<svg");
    // the packed asset was unpacked into images/ byte-for-byte
    expect(payload.files["export/E2E-export/images/image-1.png"]).toBe(
      btoa("png-bytes"),
    );
    // three exported pages → contents drawer with anchor entries; labels
    // mirror the pages' display titles (first line), untitled → "Untitled"
    expect(index).toContain('<section id="page-1">');
    expect(index).toContain('<a class="toc-item is-cover" href="#page-1"');
    expect(index).toContain('<span class="toc-header">E2E export</span>');
    expect(index).toContain('<span class="toc-header">first page</span>');
    expect(index).toContain('<a class="toc-item is-empty" href="#page-3"');
    expect(index).toContain("<span class=\"toc-header\">Untitled</span>");
    expect(index).toContain('class="icon-menu"');

    // load the exported page with its real stylesheet and images served
    // from the capture — the checks below then cover the rendered page,
    // not just strings
    await page.route("**/note.css", (route) =>
      route.fulfill({
        body: Buffer.from(
          payload.files["export/E2E-export/note.css"],
          "base64",
        ),
        contentType: "text/css",
      }),
    );
    await page.route("**/images/**", (route) => {
      // relative srcs resolve under the harness page's directory — match
      // the captured file by path suffix, not by full pathname
      const path = new URL(route.request().url()).pathname;
      const suffix = path.slice(path.indexOf("/images/")); // /images/…
      const key = Object.keys(payload.files).find((k) => k.endsWith(suffix));
      if (key == null) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({
        body: Buffer.from(payload.files[key], "base64"),
        contentType: path.endsWith(".svg") ? "image/svg+xml" : "image/png",
      });
    });
    await page.setContent(index, { waitUntil: "load" });

    // the drawer carries the navigator styles, not bare markup
    await expect(page.locator(".toc-drawer")).toHaveCSS(
      "background-color",
      "rgb(242, 243, 245)",
    );
    // the diagram displays for real: the <img> loaded its SVG file
    await expect
      .poll(() =>
        page
          .locator("figure.mermaid-figure img")
          .evaluate((el: HTMLImageElement) => el.naturalWidth),
      )
      .toBeGreaterThan(0);

    // the drawer actually toggles: click ☰, expect the drawer open; a
    // link click closes it
    await expect(page.locator(".toc-drawer")).not.toHaveClass(/is-open/);
    await page.click(".toc-toggle");
    await expect(page.locator(".toc-drawer")).toHaveClass(/is-open/);
    await page.click('.toc-drawer a[href="#page-2"]');
    await expect(page.locator(".toc-drawer")).not.toHaveClass(/is-open/);
    // Esc closes too
    await page.click(".toc-toggle");
    await page.keyboard.press("Escape");
    await expect(page.locator(".toc-drawer")).not.toHaveClass(/is-open/);
  });
});
