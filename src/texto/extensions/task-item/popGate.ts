/**
 * The task item's box pop gate (issue task-item-theme): the CSS animation
 * is keyed off the data-pop attribute, which arms on a REAL false→true
 * checked toggle and is dropped right after the animation finishes — an
 * item mounted checked never pops and later re-renders never replay it.
 *
 * The checked history lives in data-checked ON THE ELEMENT (not in caller
 * state): the node view update runs this on every attrs change, and the
 * element carries the previous state across updates even where the view
 * layer restarts the surrounding machinery.
 */
export const POP_DISARM_MS = 320;

export function applyPopGate(element: HTMLElement, nowChecked: boolean): void {
  const wasChecked = element.dataset.checked === "true";
  element.dataset.checked = String(nowChecked);

  if (nowChecked && !wasChecked) {
    element.setAttribute("data-pop", "");
    window.setTimeout(() => element.removeAttribute("data-pop"), POP_DISARM_MS);
  } else if (!nowChecked) {
    element.removeAttribute("data-pop");
  }
}
