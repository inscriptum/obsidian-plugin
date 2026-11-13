import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "../texto/core/Editor";
import type { JSONContent } from "../texto/core/@types";
import { getExtensions } from "../texto/getExtensions";
import {
  collectHeadingSections,
  getFoldedHeadingPositions,
  headingFoldingKey,
} from "../texto/extensions/heading/foldingPlugin";
import {
  collectTaskSections,
  getFoldedTaskPositions,
  taskFoldingKey,
} from "../texto/extensions/task-item-folding/taskFoldingPlugin";
import { unfoldFoldedSectionsOverlapping } from "./unfoldSections";

/**
 * Test document:
 *
 *   noteTitle  "Title"
 *   p          "Intro"
 *   h2         "Section A"   <- foldable
 *   p          "A one"
 *   h2         "Section B"   <- foldable
 *   p          "B body"
 *   taskList with a foldable task item (nested content)
 */
function testContent(): JSONContent {
  return {
    type: "noteDoc",
    content: [
      { type: "noteTitle", content: [{ type: "text", text: "Title" }] },
      { type: "paragraph", content: [{ type: "text", text: "Intro" }] },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Section A" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "A one" }] },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Section B" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "B body" }] },
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Task top" }] },
              {
                type: "bulletList",
                content: [
                  {
                    type: "listItem",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "Nested child" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Nested-heading document (see folding.test.ts 'folds nested sub-sections
 * independently' for the same shape):
 *
 *   noteTitle  "Title"
 *   p          "Intro"
 *   h2         "Outer"       <- foldable (body: p Outer body, h3, p Inner body)
 *   p          "Outer body"
 *   h3         "Inner"       <- foldable (body: p Inner body)
 *   p          "Inner body"
 */
function nestedHeadingContent(): JSONContent {
  return {
    type: "noteDoc",
    content: [
      { type: "noteTitle", content: [{ type: "text", text: "Title" }] },
      { type: "paragraph", content: [{ type: "text", text: "Intro" }] },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Outer" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "Outer body" }] },
      {
        type: "heading",
        attrs: { level: 3 },
        content: [{ type: "text", text: "Inner" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "Inner body" }] },
    ],
  };
}

/**
 * Nested-task document (mirror of the nested heading case):
 *
 *   noteTitle  "Title"
 *   taskList
 *     taskItem "Outer task"      <- foldable (body: the nested taskList)
 *       taskList
 *         taskItem "Inner task"  <- foldable (body: the nested bulletList)
 *           bulletList
 *             listItem "Inner detail"
 */
function nestedTaskContent(): JSONContent {
  return {
    type: "noteDoc",
    content: [
      { type: "noteTitle", content: [{ type: "text", text: "Title" }] },
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Outer task" }],
              },
              {
                type: "taskList",
                content: [
                  {
                    type: "taskItem",
                    attrs: { checked: false },
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "Inner task" }],
                      },
                      {
                        type: "bulletList",
                        content: [
                          {
                            type: "listItem",
                            content: [
                              {
                                type: "paragraph",
                                content: [
                                  { type: "text", text: "Inner detail" },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

interface Fixture {
  editor: Editor;
  /** Text positions of named paragraphs, by their text content. */
  textPos: (text: string) => number;
  headings: number[];
  taskItems: number[];
  dispose: () => void;
}

function createFixture(content: JSONContent = testContent()): Fixture {
  const el = document.createElement("div");
  document.body.appendChild(el);

  const editor = new Editor({
    element: el,
    content,
    extensions: getExtensions(),
    editable: true,
  });

  const positions = new Map<string, number>();
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text && !positions.has(node.text)) {
      positions.set(node.text, pos);
    }
  });

  const headings: number[] = [];
  const taskItems: number[] = [];
  editor.state.doc.forEach((node, pos) => {
    if (node.type.name === "heading") headings.push(pos);
  });
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "taskItem") taskItems.push(pos);
  });

  return {
    editor,
    textPos: (text) => positions.get(text)!,
    headings,
    taskItems,
    dispose: () => {
      editor.destroy();
      el.remove();
    },
  };
}

const fixtures: Fixture[] = [];

function useFixture(content?: JSONContent): Fixture {
  const fixture = createFixture(content ?? testContent());
  fixtures.push(fixture);
  return fixture;
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.dispose();
  }
});

function foldHeading(fixture: Fixture, pos: number): void {
  fixture.editor.view.dispatch(
    fixture.editor.state.tr.setMeta(headingFoldingKey, {
      type: "fold",
      pos,
    }),
  );
}

function foldTask(fixture: Fixture, pos: number): void {
  fixture.editor.view.dispatch(
    fixture.editor.state.tr.setMeta(taskFoldingKey, { type: "fold", pos }),
  );
}

describe("unfoldFoldedSectionsOverlapping", () => {
  it("unfolds a folded heading section containing the match", () => {
    const fixture = useFixture();
    const sectionA = fixture.headings[0];
    foldHeading(fixture, sectionA);

    const aOne = fixture.textPos("A one");
    const unfolded = unfoldFoldedSectionsOverlapping(
      fixture.editor.view,
      aOne,
      aOne + 2,
    );

    expect(unfolded).toBe(1);
    expect(getFoldedHeadingPositions(fixture.editor.state)).toEqual([]);
  });

  it("leaves sections without the match folded", () => {
    const fixture = useFixture();
    foldHeading(fixture, fixture.headings[0]); // Section A
    foldHeading(fixture, fixture.headings[1]); // Section B

    const bBody = fixture.textPos("B body");
    const unfolded = unfoldFoldedSectionsOverlapping(
      fixture.editor.view,
      bBody,
      bBody + 2,
    );

    expect(unfolded).toBe(1);
    expect(getFoldedHeadingPositions(fixture.editor.state)).toEqual([
      fixture.headings[0],
    ]);
  });

  it("unfolds every folded section overlapping the range (match across sections)", () => {
    const fixture = useFixture();
    foldHeading(fixture, fixture.headings[0]);
    foldHeading(fixture, fixture.headings[1]);

    // A range spanning both section bodies
    const aOne = fixture.textPos("A one");
    const bBody = fixture.textPos("B body");
    const unfolded = unfoldFoldedSectionsOverlapping(
      fixture.editor.view,
      aOne,
      bBody + 2,
    );

    expect(unfolded).toBe(2);
    expect(getFoldedHeadingPositions(fixture.editor.state)).toEqual([]);
  });

  it("does not touch anything when the match is on a folded heading itself", () => {
    const fixture = useFixture();
    const sectionA = fixture.headings[0];
    foldHeading(fixture, sectionA);

    // The heading text stays visible when folded — a match on it needs no unfold.
    const sections = collectHeadingSections(fixture.editor.state.doc, "heading");
    const headingTextFrom = sectionA + 1;
    const unfolded = unfoldFoldedSectionsOverlapping(
      fixture.editor.view,
      headingTextFrom,
      headingTextFrom + 3,
    );

    expect(unfolded).toBe(0);
    expect(getFoldedHeadingPositions(fixture.editor.state)).toEqual([sectionA]);
    expect(sections.length).toBeGreaterThan(0);
  });

  it("unfolds a folded task item section containing the match", () => {
    const fixture = useFixture();
    const item = fixture.taskItems[0];
    foldTask(fixture, item);

    const child = fixture.textPos("Nested child");
    const unfolded = unfoldFoldedSectionsOverlapping(
      fixture.editor.view,
      child,
      child + 2,
    );

    expect(unfolded).toBe(1);
    expect(getFoldedTaskPositions(fixture.editor.state)).toEqual([]);
  });

  it("unfolds both heading and task sections for a match inside both", () => {
    const fixture = useFixture();
    foldHeading(fixture, fixture.headings[1]); // Section B covers the task list
    foldTask(fixture, fixture.taskItems[0]);

    const child = fixture.textPos("Nested child");
    const unfolded = unfoldFoldedSectionsOverlapping(
      fixture.editor.view,
      child,
      child + 2,
    );

    expect(unfolded).toBe(2);
    expect(getFoldedHeadingPositions(fixture.editor.state)).toEqual([]);
    expect(getFoldedTaskPositions(fixture.editor.state)).toEqual([]);
  });

  it("does not unfold a folded task body when the match is on the item's own text", () => {
    const fixture = useFixture();
    const item = fixture.taskItems[0];
    foldTask(fixture, item);

    // "Task top" is the item's first paragraph — visible when folded;
    // the nested body stays hidden and must not be touched.
    const top = fixture.textPos("Task top");
    const unfolded = unfoldFoldedSectionsOverlapping(
      fixture.editor.view,
      top,
      top + 3,
    );

    expect(unfolded).toBe(0);
    expect(getFoldedTaskPositions(fixture.editor.state)).toEqual([item]);
  });

  it("keeps the match counting unchanged — folds never mutate the document", () => {
    const fixture = useFixture();
    const before = fixture.editor.state.doc.toJSON();
    foldHeading(fixture, fixture.headings[0]);
    foldTask(fixture, fixture.taskItems[0]);

    const aOne = fixture.textPos("A one");
    unfoldFoldedSectionsOverlapping(fixture.editor.view, aOne, aOne + 2);

    expect(fixture.editor.state.doc.toJSON()).toEqual(before);
  });

  it("unfolds nested heading folds in one pass (h3 inside folded h2)", () => {
    const fixture = useFixture(nestedHeadingContent());
    foldHeading(fixture, fixture.headings[0]); // "Outer" h2
    foldHeading(fixture, fixture.headings[1]); // "Inner" h3

    // The match sits inside the inner h3's body — which is also inside the
    // outer h2's body. One call must clear both folds via the two
    // consecutive dispatches of the heading loop against the captured
    // fold state.
    const innerBody = fixture.textPos("Inner body");
    const unfolded = unfoldFoldedSectionsOverlapping(
      fixture.editor.view,
      innerBody,
      innerBody + 2,
    );

    expect(unfolded).toBe(2);
    expect(getFoldedHeadingPositions(fixture.editor.state)).toEqual([]);
  });

  it("unfolds nested task item folds in one pass (taskItem inside folded taskItem)", () => {
    const fixture = useFixture(nestedTaskContent());
    foldTask(fixture, fixture.taskItems[0]); // "Outer task"
    foldTask(fixture, fixture.taskItems[1]); // "Inner task"

    // The nested detail is inside both bodies: the outer item's body holds
    // the whole subtask list, the inner item's body holds its own content.
    const detail = fixture.textPos("Inner detail");
    const sections = collectTaskSections(fixture.editor.state.doc, "taskItem");
    const outer = sections.find((s) => s.itemPos === fixture.taskItems[0])!;
    const inner = sections.find((s) => s.itemPos === fixture.taskItems[1])!;
    expect(outer.body!.from).toBeLessThan(detail);
    expect(outer.body!.to).toBeGreaterThan(detail);
    expect(inner.body!.from).toBeLessThan(detail);
    expect(inner.body!.to).toBeGreaterThan(detail);

    const unfolded = unfoldFoldedSectionsOverlapping(
      fixture.editor.view,
      detail,
      detail + 2,
    );

    expect(unfolded).toBe(2);
    expect(getFoldedTaskPositions(fixture.editor.state)).toEqual([]);
  });
});
