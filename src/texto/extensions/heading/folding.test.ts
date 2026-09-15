import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '../../core/Editor';
import type { JSONContent } from '../../core/@types';
import { getExtensions } from '../../getExtensions';
import {
  collectTaskSections,
  getFoldedTaskPositions,
} from '../task-item-folding/taskFoldingPlugin';
import {
  collectHeadingSections,
  getFoldedHeadingPositions,
  headingFoldingKey,
  restoreFoldedHeadings,
} from './foldingPlugin';
import type { HeadingSectionRange } from './foldingPlugin';

/**
 * Test document:
 *
 *   noteTitle    "Title"
 *   p            "Intro"
 *   h2           "Section A"      <- foldable (body: p A one, p A two, h3, p A1 body)
 *   p            "A one"
 *   p            "A two"
 *   h3           "Subsection A1"  <- foldable (body: p A1 body)
 *   p            "A1 body"
 *   h2           "Section B"      <- foldable (body: p B body)
 *   p            "B body"
 */
function testContent(): JSONContent {
  return {
    type: 'noteDoc',
    content: [
      { type: 'noteTitle', content: [{ type: 'text', text: 'Title' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Intro' }] },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Section A' }],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'A one' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'A two' }] },
      {
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: 'Subsection A1' }],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'A1 body' }] },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Section B' }],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'B body' }] },
    ],
  };
}

interface Fixture {
  editor: Editor;
  el: HTMLElement;
  /** Positions of the three headings in order. */
  headings: number[];
  /** Position of the paragraph "A one" (first body block of Section A). */
  aOnePos: number;
  /** Position of the paragraph inside Subsection A1. */
  a1BodyPos: number;
  dispose: () => void;
}
function createFixture(content: JSONContent = testContent()): Fixture {
  const el = createDiv();
  document.body.appendChild(el);

  const editor = new Editor({
    element: el,
    content,
    extensions: getExtensions(),
    editable: true,
  });

  const headings: number[] = [];
  editor.state.doc.forEach((node, pos) => {
    if (node.type.name === 'heading') {
      headings.push(pos);
    }
  });

  let aOnePos = -1;
  let a1BodyPos = -1;
  editor.state.doc.forEach((node, pos) => {
    if (node.type.name === 'paragraph') {
      if (node.textContent === 'A one') aOnePos = pos;
      if (node.textContent === 'A1 body') a1BodyPos = pos;
    }
  });

  return {
    editor,
    el,
    headings,
    aOnePos,
    a1BodyPos,
    dispose: () => {
      editor.destroy();
      el.remove();
    },
  };
}

const fixtures: Fixture[] = [];

function useFixture(content?: JSONContent): Fixture {
  const fixture = createFixture((content ?? testContent()));
  fixtures.push(fixture);
  return fixture;
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.dispose();
  }
});

describe('collectHeadingSections', () => {
  it('computes section bodies bounded by same-or-higher level headings', () => {
    const fixture = useFixture();
    const sections = collectHeadingSections(
      fixture.editor.state.doc,
      'heading',
    );

    expect(sections.map((s) => s.level)).toEqual([2, 3, 2]);

    const [a, a1, b] = sections as [HeadingSectionRange, HeadingSectionRange, HeadingSectionRange];

    // Section A body: everything until the next h2 ("Section B" heading pos).
    expect(a.body!.from).toBe(a.headingEnd);
    expect(a.body!.to).toBe(fixture.headings[2]);

    // Subsection body ends where Section B starts.
    expect(a1.body!.to).toBe(fixture.headings[2]);

    // Section B extends to the end of the doc.
    expect(b.body!.to).toBe(fixture.editor.state.doc.content.size);
  });

  it('gives a heading with no following content a null body', () => {
    const fixture = useFixture({
      type: 'noteDoc',
      content: [
        { type: 'noteTitle' },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Only heading' }],
        },
      ],
    } satisfies JSONContent);

    const sections = collectHeadingSections(
      fixture.editor.state.doc,
      'heading',
    );
    expect(sections).toHaveLength(1);
    expect(sections[0].body).toBeNull();
  });
});

describe('heading folding plugin', () => {
  it('folds a section via the foldHeading command and hides body blocks', () => {
    const fixture = useFixture();
    const { editor, headings, aOnePos } = fixture;

    expect(editor.commands.foldHeading(headings[0])).toBe(true);

    const chevron = fixture.el.querySelector('[data-testid="heading-fold-chevron"]');
    expect(chevron).not.toBeNull();

    // Heading itself gets is-folded.
    const headingDom = fixture.el.querySelector('h2');
    expect(headingDom?.classList.contains('is-folded')).toBe(true);

    // First body block is hidden.
    const hidden = fixture.el.querySelectorAll('.texto-folded-content');
    expect(hidden.length).toBe(4);

    // The plugin state records the position.
    expect(getFoldedHeadingPositions(editor.state)).toEqual([headings[0]]);

    // Hidden nodes' DOM gets the display:none class.
    const aOneDom = editor.view.domAtPos(aOnePos + 1).node as HTMLElement;
    expect(aOneDom.classList.contains('texto-folded-content')).toBe(true);
  });

  it('unfolds with unfoldHeading and removes all hiding decorations', () => {
    const fixture = useFixture();
    const { editor, headings } = fixture;

    editor.commands.foldHeading(headings[0]);
    editor.commands.unfoldHeading(headings[0]);

    expect(fixture.el.querySelector('.texto-folded-content')).toBeNull();
    expect(fixture.el.querySelector('h2')?.classList.contains('is-folded')).toBe(false);
    expect(getFoldedHeadingPositions(editor.state)).toEqual([]);
  });

  it('toggleHeadingFold toggles from a selection inside the heading', () => {
    const fixture = useFixture();
    const { editor, headings, aOnePos } = fixture;

    // Caret inside "A one" — no heading ancestor there; toggle via heading pos.
    editor.commands.setTextSelection(aOnePos + 1);
    expect(editor.commands.toggleHeadingFold()).toBe(false);

    // Caret inside the heading "Section A".
    editor.commands.setTextSelection(headings[0] + 1);
    expect(editor.commands.toggleHeadingFold()).toBe(true);
    expect(getFoldedHeadingPositions(editor.state)).toEqual([headings[0]]);

    expect(editor.commands.toggleHeadingFold()).toBe(true);
    expect(getFoldedHeadingPositions(editor.state)).toEqual([]);
  });

  it('pushes the caret out of the hidden region when folding', () => {
    const fixture = useFixture();
    const { editor, headings, aOnePos } = fixture;

    // Caret inside the body that is about to be hidden.
    editor.commands.setTextSelection(aOnePos + 2);

    editor.commands.foldHeading(headings[0]);

    // Selection must no longer be inside the folded body.
    const { from, to } = editor.state.selection;
    const state = headingFoldingKey.getState(editor.state);
    expect(state).toBeDefined();
    const sections = collectHeadingSections(editor.state.doc, 'heading');
    const body = sections[0].body!;
    expect(to <= body.from || from >= body.to).toBe(true);
  });

  it('folds nested sub-sections independently', () => {
    const fixture = useFixture();
    const { editor, headings, a1BodyPos } = fixture;

    // Fold only the h3 subsection.
    editor.commands.foldHeading(headings[1]);

    const hidden = fixture.el.querySelectorAll('.texto-folded-content');
    expect(hidden.length).toBe(1);

    const a1BodyDom = editor.view.domAtPos(a1BodyPos + 1).node as HTMLElement;
    expect(a1BodyDom.classList.contains('texto-folded-content')).toBe(true);
  });

  it('keeps folds mapped when the document is edited above them', () => {
    const fixture = useFixture();
    const { editor, headings } = fixture;

    editor.commands.foldHeading(headings[2]); // fold Section B

    // Insert a paragraph before "Section A" — all positions shift.
    editor.commands.insertContentAt(0 + editor.state.doc.firstChild!.nodeSize, {
      type: 'paragraph',
      content: [{ type: 'text', text: 'new intro' }],
    });

    const positions = getFoldedHeadingPositions(editor.state);
    expect(positions).toHaveLength(1);

    // The new position must still point at the "Section B" heading.
    const node = editor.state.doc.nodeAt(positions[0]);
    expect(node?.type.name).toBe('heading');
    expect(node?.textContent).toBe('Section B');

    // And its body is still hidden.
    const hidden = fixture.el.querySelectorAll('.texto-folded-content');
    expect(hidden.length).toBe(1);
    expect(
      (hidden[0] as HTMLElement).textContent,
    ).toBe('B body');
  });

  it('drops folds whose heading was deleted', () => {
    const fixture = useFixture();
    const { editor, headings } = fixture;

    editor.commands.foldHeading(headings[0]);

    // Delete the "Section A" heading node.
    editor.commands.command(({ tr }) => {
      tr.delete(headings[0], headings[0] + editor.state.doc.nodeAt(headings[0])!.nodeSize);
      return true;
    });

    expect(getFoldedHeadingPositions(editor.state)).toEqual([]);
    expect(fixture.el.querySelector('.texto-folded-content')).toBeNull();
  });

  it('restores folds from positions via the restore meta', () => {
    const fixture = useFixture();
    const { editor, headings } = fixture;

    restoreFoldedHeadings(editor.view, [headings[0], headings[2]]);

    expect(getFoldedHeadingPositions(editor.state).sort((a, b) => a - b)).toEqual(
      [headings[0], headings[2]],
    );
    expect(fixture.el.querySelectorAll('h2.is-folded').length).toBe(2);
  });

  it('does not mutate the document while folding (no docChanged)', () => {
    const fixture = useFixture();
    const { editor, headings } = fixture;

    const jsonBefore = JSON.stringify(editor.getJSON());

    let sawDocChange = false;
    editor.on('transaction', ({ transaction }) => {
      if (transaction.docChanged) sawDocChange = true;
    });

    editor.commands.foldHeading(headings[0]);
    editor.commands.unfoldHeading(headings[0]);

    expect(sawDocChange).toBe(false);
    expect(JSON.stringify(editor.getJSON())).toBe(jsonBefore);
  });

  it('exposes positions through editor.storage for the host', () => {
    const fixture = useFixture();
    const { editor, headings } = fixture;

    editor.commands.foldHeading(headings[0]);

    const storage = editor.storage.headingFolding as { positions?: number[] };
    expect(storage.positions).toEqual([headings[0]]);
  });

  it('is disabled when the extension is configured off (mobile)', () => {
    const el = createDiv();
    document.body.appendChild(el);

    const editor = new Editor({
      element: el,
      content: testContent(),
      extensions: getExtensions({}, { isMobileView: true }),
      editable: true,
    });
    fixtures.push({
      editor,
      el,
      headings: [],
      aOnePos: -1,
      a1BodyPos: -1,
      dispose: () => {
        editor.destroy();
        el.remove();
      },
    });

    expect(headingFoldingKey.getState(editor.state)).toBeUndefined();
    expect(el.querySelector('[data-testid="heading-fold-chevron"]')).toBeNull();
  });
});

describe('heading folding regressions', () => {
  it('deleting a folded heading drops the fold instead of transferring it to the next heading', () => {
    // Regression: mapping.map(pos, -1) mapped a deleted heading's fold onto
    // the position of the NEXT heading (type check passed) — after deleting
    // a collapsed "Section A", "Section B" would collapse on its own.
    const fixture = useFixture();
    const { editor, headings } = fixture;

    editor.commands.foldHeading(headings[0]); // fold "Section A"
    expect(getFoldedHeadingPositions(editor.state)).toEqual([headings[0]]);

    // Delete the folded "Section A" heading node.
    editor.commands.command(({ tr }) => {
      tr.delete(
        headings[0],
        headings[0] + editor.state.doc.nodeAt(headings[0])!.nodeSize,
      );
      return true;
    });

    expect(getFoldedHeadingPositions(editor.state)).toEqual([]);
    expect(fixture.el.querySelector('.texto-folded-content')).toBeNull();
  });

  it('deleting an earlier heading keeps later folds mapped onto their own headings', () => {
    const fixture = useFixture();
    const { editor, headings } = fixture;

    editor.commands.foldHeading(headings[2]); // fold "Section B"

    // Delete "Section A" — "Section B" must stay folded, on its own node.
    editor.commands.command(({ tr }) => {
      tr.delete(
        headings[0],
        headings[0] + editor.state.doc.nodeAt(headings[0])!.nodeSize,
      );
      return true;
    });

    const positions = getFoldedHeadingPositions(editor.state);
    expect(positions).toHaveLength(1);
    const node = editor.state.doc.nodeAt(positions[0]);
    expect(node?.type.name).toBe('heading');
    expect(node?.textContent).toBe('Section B');
  });

  it('moves the caret out of the hidden body when a transaction lands it there', () => {
    // Regression: only fold-meta transactions pushed the caret out; a
    // programmatic jump (or paste/drop) into a hidden body left the caret
    // typing invisibly. Sink a selection into the hidden region without
    // fold meta and expect the plugin to push it out.
    const fixture = useFixture();
    const { editor, headings, aOnePos } = fixture;

    editor.commands.foldHeading(headings[0]); // fold "Section A"

    // Jump straight into the hidden body (no fold meta on this tr).
    editor.commands.setTextSelection(aOnePos + 2);

    const { from, to } = editor.state.selection;
    const sections = collectHeadingSections(editor.state.doc, 'heading');
    const body = sections[0].body!;
    expect(to <= body.from || from >= body.to).toBe(true);
  });
});

describe('heading folding regressions: Cmd+A and Enter', () => {
  it('selectAll keeps the whole-document selection while a fold exists (Cmd+A bug)', () => {
    // Regression: the caret push-out treated ANY selection overlapping a
    // hidden body as accidental — including the whole-document selection
    // from Cmd+A — and collapsed it back into the heading, so with any
    // fold present Cmd+A appeared to "not work".
    //
    // selectAll maps to a TextSelection from the first text position to
    // the last one (1 .. docSize - 1 for a noteDoc) — assert it stays a
    // wide selection covering the folded section instead of a caret.
    const fixture = useFixture();
    const { editor, headings } = fixture;

    editor.commands.foldHeading(headings[0]); // fold "Section A"

    editor.commands.selectAll();

    const { from, to } = editor.state.selection;
    expect(from).toBe(1);
    expect(to).toBe(editor.state.doc.content.size - 1);
    // And it covers the whole folded section (not pushed into the heading).
    const sections = collectHeadingSections(editor.state.doc, 'heading');
    const body = sections[0].body!;
    expect(from).toBeLessThanOrEqual(sections[0].headingPos);
    expect(to).toBeGreaterThanOrEqual(body.to);
  });

  it('selectAll keeps the whole-document selection while a task fold exists', () => {
    // Same guard, task-item path: one folded task item must not swallow
    // Cmd+A either.
    const fixture = useFixture({
      type: 'noteDoc',
      content: [
        { type: 'noteTitle', content: [{ type: 'text', text: 'Title' }] },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'parent' }] },
                {
                  type: 'taskList',
                  content: [
                    {
                      type: 'taskItem',
                      attrs: { checked: false },
                      content: [
                        { type: 'paragraph', content: [{ type: 'text', text: 'child' }] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } satisfies JSONContent);
    const { editor } = fixture;

    const itemPos = editor.state.doc.content.size - 8; // computed below instead
    // Find the parent task item position programmatically.
    let parentPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'taskItem' && node.childCount > 1) {
        parentPos = pos;
        return false;
      }
      return true;
    });
    expect(parentPos).toBeGreaterThan(0);
    void itemPos;

    editor.commands.foldTask(parentPos);
    expect(getFoldedTaskPositions(editor.state)).toEqual([parentPos]);

    editor.commands.selectAll();

    // Same wide-selection assertion as the heading case: the selection
    // must stay wide (cover the folded item), not collapse to a caret.
    const { from, to } = editor.state.selection;
    expect(to - from).toBeGreaterThan(4);
    const sections = collectTaskSections(editor.state.doc, 'taskItem');
    const section = sections.find((s) => s.itemPos === parentPos)!;
    expect(section.body).not.toBeNull();
    expect(from).toBeLessThan(section.body!.from);
    expect(to).toBeGreaterThan(section.body!.from);
  });

  it('Enter at the end of a folded heading unfolds and inserts a line after the body (Enter bug)', () => {
    // Regression: Enter at the end of a folded heading's text ran the
    // core splitBlock INSIDE the hidden region — the new paragraph landed
    // right behind the heading, the caret was pushed back by the
    // push-out guard, and to the user Enter "did nothing". Expected:
    // the section unfolds and the new empty line appears after the
    // (now visible) section body, caret inside it.
    const fixture = useFixture();
    const { editor, headings } = fixture;

    editor.commands.foldHeading(headings[0]); // fold "Section A"

    // Caret at the end of the folded heading's text.
    const headingNode = editor.state.doc.nodeAt(headings[0])!;
    editor.commands.setTextSelection(
      headings[0] + 1 + headingNode.content.size,
    );

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    // NOTE: someProp stops at the first handler returning true — the
    // callback must early-return true as well, otherwise later handlers
    // (core splitBlock) run too and double-apply Enter.
    let handled = false;
    editor.view.someProp('handleKeyDown', (f) => {
      handled = f(editor.view, event) || handled;
      return handled;
    });
    expect(handled).toBe(true);

    // 1. The section is unfolded.
    expect(getFoldedHeadingPositions(editor.state)).toEqual([]);
    expect(fixture.el.querySelectorAll('.texto-folded-content').length).toBe(0);

    // 2. A new empty paragraph exists after the section body, right
    //    before the next heading, and the caret is inside it.
    const sections = collectHeadingSections(editor.state.doc, 'heading');
    const body = sections[0].body!;
    const $bodyEnd = editor.state.doc.resolve(body.to);
    // The last body block is the newly inserted empty paragraph...
    expect($bodyEnd.nodeBefore?.textContent).toBe('');
    expect($bodyEnd.nodeBefore?.type.name).toBe('paragraph');
    // ...and the block before it is the former last body block.
    const $prevEnd = editor.state.doc.resolve(body.to - $bodyEnd.nodeBefore!.nodeSize);
    expect($prevEnd.nodeBefore?.textContent).toBe('A1 body');

    const { from } = editor.state.selection;
    const $sel = editor.state.doc.resolve(from);
    expect($sel.parent.type.name).toBe('paragraph');
    expect($sel.parent.textContent).toBe('');
    // The caret's block is the new paragraph: it ends exactly where the
    // section body ends (before the next heading).
    expect($sel.after()).toBe(body.to);
  });

  it('plain Enter elsewhere keeps the core behavior with folds present', () => {
    // The keymap plugin must not disturb Enter outside its one case.
    const fixture = useFixture();
    const { editor, headings, aOnePos } = fixture;

    editor.commands.foldHeading(headings[0]); // fold "Section A"

    // Caret at the start of "A two" (a body block of the folded section
    // is hidden — pick a visible spot: the note title) — use the title.
    // Simpler: caret in the intro paragraph (before the fold).
    const introPos = (() => {
      let pos = -1;
      editor.state.doc.forEach((node, offset) => {
        if (node.type.name === 'paragraph' && node.textContent === 'Intro' && pos < 0) {
          pos = offset + 1;
        }
      });
      return pos;
    })();
    expect(introPos).toBeGreaterThan(0);
    editor.commands.setTextSelection(introPos + 2);
    void aOnePos;

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    let handled = false;
    editor.view.someProp('handleKeyDown', (f) => {
      handled = f(editor.view, event) || handled;
      return handled;
    });
    // The plugin chain as a whole handles Enter (some binding does),
    // and the fold survived (mapped to the heading's shifted position).
    const folded = getFoldedHeadingPositions(editor.state);
    expect(folded).toHaveLength(1);
    const foldedNode = editor.state.doc.nodeAt(folded[0]);
    expect(foldedNode?.type.name).toBe('heading');
    expect(foldedNode?.textContent).toBe('Section A');
    expect(handled).toBe(true);
  });
});
