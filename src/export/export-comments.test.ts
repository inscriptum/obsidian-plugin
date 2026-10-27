import { describe, expect, it } from "vitest";
import { generateHTML } from "../texto/core/helpers/generateHTML";
import { getExportExtensions } from "./extensions";

describe("website export with comment anchors", () => {
  // Regression guard (issue comments): the anchor mark must be in the
  // export schema, or Node.fromJSON throws for any stored page that
  // carries one — and the whole notepad export fails.
  it("exports a page with anchors; the anchor renders neutral", () => {
    const doc = {
      type: "noteDoc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "before " },
            {
              type: "text",
              text: "anchored",
              marks: [{ type: "comment", attrs: { id: "T1" } }],
            },
          ],
        },
      ],
    };
    const html = generateHTML(doc, getExportExtensions());
    // A bare span: no attribute to resurrect the anchor when site text is
    // copied back into the editor, and no editor styling hooks.
    expect(html).toContain("<span>anchored</span>");
    expect(html).not.toContain("data-comment-id");
    expect(html).toContain("anchored");
  });
});
