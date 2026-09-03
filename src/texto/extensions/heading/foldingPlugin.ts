import type { Node as ProseMirrorNode, ResolvedPos } from 'prosemirror-model';
import {
  Plugin,
  PluginKey,
  Selection,
  type EditorState,
  type Transaction,
} from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

/**
 * Heading folding — decoration-based folding, modeled after
 * https://prosemirror.net/examples/fold/ (see also
 * https://discuss.prosemirror.net/t/text-folding/439/8 and bangle-editor's
 * collapsible headings).
 *
 * Design decisions (vs. bangle-editor's `collapseContent` attribute):
 *  - The document is NEVER mutated: folded content stays in the doc and is
 *    hidden with node decorations (`display:none`). Bangle cuts the section
 *    into a node attribute, which would fire our state extension's onRemove
 *    hook (deleting image files from disk), pollute undo history and hide
 *    content from the document search.
 *  - Fold state lives in this plugin (like the PM example). Persistence is
 *    host-side: the HeadingFolding extension mirrors the current positions
 *    into editor.storage.headingFolding.positions on every transaction;
 *    the host (NoteView) saves them via Obsidian's
 *    app.saveLocalStorage("note-fold-<path>") like native notes do.
 */

export const headingFoldingKey = new PluginKey<HeadingFoldingState>(
  'inscriptumHeadingFolding',
);

export type HeadingFoldingMeta =
  | { type: 'toggle'; pos: number }
  | { type: 'fold'; pos: number }
  | { type: 'unfold'; pos: number }
  | { type: 'restore'; positions: number[] };

export interface HeadingFoldingState {
  /** Positions (doc offsets) of folded heading nodes. */
  folded: Set<number>;
}

export interface HeadingSectionRange {
  /** Position of the heading node. */
  headingPos: number;
  /** End of the heading node. */
  headingEnd: number;
  /** Section body range (exclusive of the heading), null when empty. */
  body: { from: number; to: number } | null;
  /** Heading level. */
  level: number;
}

/** CSS classes used by the decorations (see styles/heading-folding.css). */
export const FOLDING_CSS = {
  headingCollapsed: 'is-folded',
  contentHidden: 'texto-folded-content',
  /** Layout class on the chevron custom element host. */
  chevronHost: 'texto-heading-fold-chevron-host',
} as const;

export interface HeadingFoldingPluginOptions {
  headingTypeName: string;
  /** The chevron custom element class to instantiate in widgets. */
  chevronElement: new () => HTMLElement;
}

export function createHeadingFoldingPlugin(
  options: HeadingFoldingPluginOptions,
): Plugin<HeadingFoldingState> {
  const { headingTypeName, chevronElement } = options;

  return new Plugin<HeadingFoldingState>({
    key: headingFoldingKey,

    state: {
      init: (): HeadingFoldingState => ({ folded: new Set() }),

      apply(tr, value): HeadingFoldingState {
        let folded = value.folded;

        // Map positions through the transaction (keeps folds while editing).
        if (tr.docChanged) {
          const next = new Set<number>();
          for (const pos of folded) {
            const mapped = tr.mapping.map(pos, -1);
            const node = tr.doc.resolve(mapped).nodeAfter;
            // Drop folds whose heading was deleted.
            if (node != null && node.type.name === headingTypeName) {
              next.add(mapped);
            }
          }
          folded = next;
        }

        const meta = tr.getMeta(headingFoldingKey) as
          | HeadingFoldingMeta
          | undefined;

        if (meta != null) {
          const next = new Set(folded);
          if (meta.type === 'toggle') {
            if (next.has(meta.pos)) {
              next.delete(meta.pos);
            } else {
              next.add(meta.pos);
            }
          } else if (meta.type === 'fold') {
            next.add(meta.pos);
          } else if (meta.type === 'unfold') {
            next.delete(meta.pos);
          } else if (meta.type === 'restore') {
            for (const pos of meta.positions) {
              next.add(pos);
            }
          }
          folded = next;
        }

        if (folded === value.folded) {
          return value;
        }

        return { folded };
      },
    },

    props: {
      decorations(state: EditorState): DecorationSet {
        const pluginState = headingFoldingKey.getState(state);
        if (pluginState == null) {
          return DecorationSet.empty;
        }
        return buildFoldDecorations(state, pluginState, headingTypeName, chevronElement);
      },
    },

    appendTransaction(
      transactions: readonly Transaction[],
      _oldState: EditorState,
      newState: EditorState,
    ): Transaction | null {
      const foldMeta = transactions.some(
        (tr) => tr.getMeta(headingFoldingKey) != null,
      );
      if (!foldMeta) {
        return null;
      }

      const pluginState = headingFoldingKey.getState(newState);
      if (pluginState == null) {
        return null;
      }

      // Push the caret out of the newly hidden region — back into the
      // heading itself (the heading stays visible and editable, like
      // Obsidian's collapsed headings).
      const sections = collectHeadingSections(newState.doc, headingTypeName);
      const { selection } = newState;
      let target: number | null = null;

      for (const section of sections) {
        if (
          !pluginState.folded.has(section.headingPos) ||
          section.body == null
        ) {
          continue;
        }
        const { from: bodyFrom, to: bodyTo } = section.body;
        if (selection.to > bodyFrom && selection.from < bodyTo) {
          target = section.headingEnd;
          break;
        }
      }

      if (target == null) {
        return null;
      }

      // bias -1: resolve back into the heading text, not forward into the
      // (now hidden) first body block.
      const next = Selection.near(newState.doc.resolve(target), -1);
      if (next.eq(selection)) {
        return null;
      }

      const tr = newState.tr;
      tr.setSelection(next).setMeta('addToHistory', false);
      return tr;
    },
  });
}

/** Build chevron widgets + fold/hide node decorations for the fold state. */
function buildFoldDecorations(
  state: EditorState,
  pluginState: HeadingFoldingState,
  headingTypeName: string,
  chevronElement: new () => HTMLElement,
): DecorationSet {
  const decorations: Decoration[] = [];
  const doc = state.doc;
  const folded = pluginState.folded;

  const sections = collectHeadingSections(doc, headingTypeName);

  for (const section of sections) {
    const isFolded = folded.has(section.headingPos);

    // Chevron widget at the very start of the heading content.
    decorations.push(
      Decoration.widget(
        section.headingPos + 1,
        (view: EditorView) =>
          createChevronDom(
            view,
            section.headingPos,
            headingTypeName,
            chevronElement,
          ),
        {
          side: -1,
          // The chevron fully owns its pointer events; PM's selection
          // machinery must ignore clicks inside it.
          stopEvent: () => true,
          ignoreSelection: true,
          marks: [],
          key: `heading-fold-chevron-${section.headingPos}`,
        },
      ),
    );

    if (!isFolded) {
      continue;
    }

    decorations.push(
      Decoration.node(
        section.headingPos,
        section.headingEnd,
        { class: FOLDING_CSS.headingCollapsed },
        { headingFold: true },
      ),
    );

    if (section.body == null) {
      continue;
    }

    const { from: bodyFrom, to: bodyTo } = section.body;
    // Hide every top-level block of the section body.
    doc.nodesBetween(bodyFrom, bodyTo, (node, pos) => {
      if (pos < bodyFrom || pos >= bodyTo) {
        return false;
      }
      if (node.isBlock) {
        decorations.push(
          Decoration.node(
            pos,
            pos + node.nodeSize,
            { class: FOLDING_CSS.contentHidden },
            { headingFoldContent: true },
          ),
        );
        return false;
      }
      return true;
    });
  }

  return DecorationSet.create(doc, decorations);
}

/** Create the chevron DOM element with its click handler. */
function createChevronDom(
  view: EditorView,
  headingPos: number,
  headingTypeName: string,
  chevronElement: new () => HTMLElement,
): HTMLElement {
  // Custom element (see view/chevron.element.tsx), hosted like the
  // image/task-item node views: the versioned element carries the layout
  // class (CSS targets it inside the heading), its light DOM renders the
  // chevron markup. The folded state comes from the heading's is-folded
  // node decoration + CSS; the click handler stays here, next to the fold
  // meta it dispatches.
  const chevron = new chevronElement();
  chevron.classList.add(FOLDING_CSS.chevronHost);

  const onClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (view.isDestroyed) {
      return;
    }

    const { state } = view;
    const node = state.doc.nodeAt(headingPos);
    if (node != null && node.type.name === headingTypeName) {
      const meta: HeadingFoldingMeta = { type: 'toggle', pos: headingPos };
      view.dispatch(state.tr.setMeta(headingFoldingKey, meta));
    }
  };

  chevron.addEventListener('click', onClick);

  return chevron;
}

/**
 * Collect all foldable sections: each heading in the doc plus its body range
 * (everything up to the next heading of the same or higher level).
 */
export function collectHeadingSections(
  doc: ProseMirrorNode,
  headingTypeName: string,
): HeadingSectionRange[] {
  const sections: HeadingSectionRange[] = [];
  // Sections not yet closed, indexed by heading level (index = level).
  const open: (HeadingSectionRange | null)[] = [];

  doc.forEach((node, pos) => {
    if (node.type.name !== headingTypeName) {
      return;
    }

    const level = node.attrs.level as number;
    const section: HeadingSectionRange = {
      headingPos: pos,
      headingEnd: pos + node.nodeSize,
      body: null,
      level,
    };

    // A heading of level N closes every still-open section with level >= N.
    for (let lvl = 0; lvl < open.length; lvl += 1) {
      const prev = open[lvl];
      if (prev != null && lvl >= level) {
        prev.body = { from: prev.headingEnd, to: pos };
        open[lvl] = null;
      }
    }

    sections.push(section);
    open[level] = section;
  });

  // Sections still open at the doc end extend to the end of the doc.
  const docEnd = doc.content.size;
  for (const section of sections) {
    if (section.body == null && open[section.level] === section) {
      section.body = { from: section.headingEnd, to: docEnd };
    }
  }

  // An empty body (start == end) means there is nothing to fold.
  for (const section of sections) {
    if (section.body != null && section.body.from >= section.body.to) {
      section.body = null;
    }
  }

  return sections;
}

/** Current folded heading positions (for persistence). */
export function getFoldedHeadingPositions(state: EditorState): number[] {
  const pluginState = headingFoldingKey.getState(state);
  return pluginState ? Array.from(pluginState.folded) : [];
}

/** All heading sections of the current doc (host UI may use it). */
export function getHeadingRanges(state: EditorState): HeadingSectionRange[] {
  return collectHeadingSections(state.doc, 'heading');
}

/** Dispatch a restore meta with the given heading positions. */
export function restoreFoldedHeadings(
  view: EditorView,
  positions: number[],
): void {
  const meta: HeadingFoldingMeta = { type: 'restore', positions };
  view.dispatch(view.state.tr.setMeta(headingFoldingKey, meta));
}

/** Find the heading position for a resolved position (nearest heading up the tree). */
export function findHeadingPos($pos: ResolvedPos): number | null {
  for (let depth = $pos.depth; depth >= 1; depth -= 1) {
    const node = $pos.node(depth);
    if (node.type.name === 'heading') {
      return $pos.before(depth);
    }
  }
  return null;
}
