type checkboxOn = string;
type checkboxOff = string;

/**
 * The default checkbox icon pair — the sprite ids defined in
 * note.element.tsx (rendered once per editor host, referenced via <use>).
 * When the options carry exactly this pair, the item view switches to an
 * inline SVG with a draw-in checkmark (issue task-item-theme); any other
 * pair keeps the plain <use> sprite path without animation.
 *
 * Leaf module: task-item.ts and view/item.element.tsx both need the value,
 * and a value import from the view back into the extension file would make
 * a runtime import cycle between them.
 */
export const DEFAULT_CHECKBOX_ICONS: [checkboxOn, checkboxOff] = [
  "check_box_on_20",
  "check_box_off_20",
];
