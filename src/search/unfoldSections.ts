import type { EditorView } from "prosemirror-view";
import {
  collectHeadingSections,
  headingFoldingKey,
} from "../texto/extensions/heading/foldingPlugin";
import {
  collectTaskSections,
  taskFoldingKey,
} from "../texto/extensions/task-item-folding/taskFoldingPlugin";

/**
 * Unfold every folded heading/task section whose hidden body overlaps or
 * abuts the given document range. Used by search jumps: matches inside
 * folded sections are invisible (display:none decorations), so the section
 * of the current match must expand before the scroll can land on it.
 * Sections without a match in their body are left folded. Folded state
 * persists as usual — an unfold here is indistinguishable from a manual one.
 *
 * The overlap test is closed-interval: a section whose body merely touches
 * the range boundary (body.from === to || body.to === from) is unfolded
 * too. Unreachable from the current search call sites (a match always sits
 * strictly inside its section), but the desired behavior for future
 * selection-based ranges.
 */
export function unfoldFoldedSectionsOverlapping(
  view: EditorView,
  from: number,
  to: number,
): number {
  const state = view.state;
  let unfolded = 0;
  const headingState = headingFoldingKey.getState(state);
  if (headingState && headingState.folded.size > 0) {
    for (const section of collectHeadingSections(state.doc, "heading")) {
      if (
        !headingState.folded.has(section.headingPos) ||
        section.body == null ||
        section.body.from > to ||
        section.body.to < from
      ) {
        continue;
      }
      view.dispatch(
        view.state.tr.setMeta(headingFoldingKey, {
          type: "unfold",
          pos: section.headingPos,
        }),
      );
      unfolded += 1;
    }
  }

  const taskState = taskFoldingKey.getState(state);
  if (taskState && taskState.folded.size > 0) {
    for (const section of collectTaskSections(state.doc, "taskItem")) {
      if (
        !taskState.folded.has(section.itemPos) ||
        section.body == null ||
        section.body.from > to ||
        section.body.to < from
      ) {
        continue;
      }
      view.dispatch(
        view.state.tr.setMeta(taskFoldingKey, {
          type: "unfold",
          pos: section.itemPos,
        }),
      );
      unfolded += 1;
    }
  }

  return unfolded;
}
