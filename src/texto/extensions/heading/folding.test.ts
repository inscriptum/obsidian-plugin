import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '../../core/Editor';
import type { JSONContent } from '../../core/@types';
import { getExtensions } from '../../getExtensions';
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
  const fixture = createFixture((content ?? testContent()) as JSONContent);
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
