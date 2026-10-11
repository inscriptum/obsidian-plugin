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
  });
});
