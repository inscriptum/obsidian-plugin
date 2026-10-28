import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { CommentHooks } from "./model";

export const commentsPluginKey = new PluginKey<CommentsPluginState>(
  "inscriptumComments",
);

/** One contiguous comment-anchor range (adjacent text nodes with the same
 *  mark merge into one — marks split text nodes on edits). */
export interface CommentRange {
  id: string;
  from: number;
  to: number;
}

interface CommentsPluginState {
  /** Bumped by refresh metas — thread data changed without a doc change. */
  revision: number;
  ranges: CommentRange[];
  decorations: DecorationSet;
}

type CommentsMeta = { refresh?: true } | undefined;

/** Collect all comment-anchor ranges of a document. Pure — also used by the
 *  view for jump-to-anchor and by tests. */
export function findCommentRanges(doc: ProseMirrorNode): CommentRange[] {
  const ranges: CommentRange[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.marks.length) return;
    const mark = node.marks.find((m) => m.type.name === "comment");
    if (!mark) return;
    const id = mark.attrs.id as string | null;
    if (!id) return;
    const last = ranges[ranges.length - 1];
    if (last && last.id === id && last.to === pos) {
      last.to = pos + node.text!.length;
    } else {
      ranges.push({ id, from: pos, to: pos + node.text!.length });
    }
  });
  return ranges;
}

/** Anchor ranges of one thread id. */
export function getCommentRanges(
  doc: ProseMirrorNode,
  threadId: string,
): CommentRange[] {
  return findCommentRanges(doc).filter((range) => range.id === threadId);
}

/** Rebuild the anchor decorations (highlight + counter bubble per range). */
function buildDecorations(
  doc: ProseMirrorNode,
  ranges: CommentRange[],
  hooks: CommentHooks | null,
): DecorationSet {
  if (ranges.length === 0 || !hooks) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  for (const range of ranges) {
    const thread = hooks.findThread(range.id);
    decorations.push(
      Decoration.inline(range.from, range.to, {
        class: thread?.resolved
          ? "inscriptum-comment-anchor is-resolved"
          : "inscriptum-comment-anchor",
      }),
    );
        if (!thread || thread.commentCount === 0) continue;
        // The footnote-style count marker rides the range end. Key carries
        // the rendered state so a refresh meta swaps the DOM; plain key
        // equality keeps the widget stable across typing.
        decorations.push(
          Decoration.widget(
            range.to,
            () => {
              // Host-injected DOM helper (Obsidian / harness / vitest setup) —
              // the same global texto extensions use everywhere.
              const ref = createSpan();
              ref.className = thread.resolved
                ? "inscriptum-comment-ref is-resolved"
                : "inscriptum-comment-ref";
              ref.textContent = String(thread.commentCount);
              ref.addEventListener("pointerdown", (event) => {
                // The marker is not a caret target: a click must not move
                // the selection into the text (and must not reach handleClick).
                event.preventDefault();
                event.stopPropagation();
                hooks.openThread(range.id);
              });
              return ref;
            },
            {
              side: 1,
              key: `comment-${range.id}-${thread.commentCount}-${thread.resolved ? 1 : 0}`,
            },
          ),
        );
  }
  return DecorationSet.create(doc, decorations);
}

/** Anchor click → the host opens the panel on the thread. */
function handleClickOnAnchor(
  view: { state: EditorState },
  pos: number,
  hooks: CommentHooks | null,
): boolean {
  if (!hooks) return false;
  const $pos = view.state.doc.resolve(pos);
  const mark = $pos.marks().find((m) => m.type.name === "comment");
  if (!mark?.attrs.id) return false;
  hooks.openThread(mark.attrs.id as string);
  return false; // selection handling stays PM's
}

export function createCommentsPlugin(hooks: CommentHooks | null): Plugin<CommentsPluginState> {
  return new Plugin<CommentsPluginState>({
    key: commentsPluginKey,
    state: {
      init: (config, state: EditorState): CommentsPluginState => {
        const ranges = findCommentRanges(state.doc);
        return {
          revision: 0,
          ranges,
          decorations: buildDecorations(state.doc, ranges, hooks),
        };
      },
      apply: (
        tr: Transaction,
        previous: CommentsPluginState,
        _oldState: EditorState,
        newState: EditorState,
      ): CommentsPluginState => {
        const meta = tr.getMeta(commentsPluginKey) as CommentsMeta;
        if (!tr.docChanged && !meta?.refresh) return previous;
        const ranges = findCommentRanges(newState.doc);
        return {
          revision: meta?.refresh ? previous.revision + 1 : previous.revision,
          ranges,
          decorations: buildDecorations(newState.doc, ranges, hooks),
        };
      },
    },
    props: {
      decorations: (state: EditorState) =>
        commentsPluginKey.getState(state)?.decorations ?? DecorationSet.empty,
      handleClick: (view, pos, _event) =>
        handleClickOnAnchor(view, pos, hooks),
    },
  });
}

/** Tell the plugin that thread data changed (resolve, reply, …) — the host
 *  dispatches this after every store mutation so anchors re-render. */
export function refreshComments(state: EditorState): Transaction {
  return state.tr.setMeta(commentsPluginKey, { refresh: true });
}
