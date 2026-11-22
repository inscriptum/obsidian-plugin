/**
 * Isolated adapter for Obsidian's empty-tab state ("no file open").
 *
 * Obsidian has no public API to add actions to the empty view; the owner
 * approved a scoped DOM integration. The adapter appends two pill actions
 * ("New um", then "New inscriptum") to every visible empty view's action
 * list and removes them again. Selection is structural only (never by
 * localized labels); lifecycle is driven by public workspace events from
 * main.ts, so this module stays free of plugin-instance coupling.
 */

import { setIcon } from "obsidian";

const EMPTY_CONTENT_SELECTOR = '.workspace-leaf-content[data-type="empty"]';
const ACTION_LIST_SELECTOR = ".empty-state-action-list";
const MARKER_CLASS = "inscriptum-empty-action";

export interface EmptyTabAction {
  /** Marker class unique to this action (also the idempotency key). */
  cls: string;
  label: string;
  /** Icon name resolvable by Obsidian's setIcon (Lucide or registered via addIcon). */
  icon: string;
  onClick: (event: MouseEvent | KeyboardEvent) => void;
}

/** Append the given actions to the empty view's action list of every empty
 *  leaf content in `root`. Idempotent per marker class; a missing expected
 *  DOM structure is skipped silently — other creation paths stay intact. */
export function ensureEmptyTabActions(
  root: ParentNode,
  actions: EmptyTabAction[],
): void {
  const lists = root.querySelectorAll<HTMLElement>(
    `${EMPTY_CONTENT_SELECTOR} ${ACTION_LIST_SELECTOR}`,
  );
  for (const list of lists) {
    for (const action of actions) {
      if (list.querySelector(`.${action.cls}`)) continue;
      list.appendChild(buildActionEl(action));
    }
  }
}

/** Remove every injected empty-tab action under `root` (plugin unload). */
export function removeEmptyTabActions(root: ParentNode): void {
  root
    .querySelectorAll<HTMLElement>(`.${MARKER_CLASS}`)
    .forEach((el) => el.remove());
}

function buildActionEl(action: EmptyTabAction): HTMLElement {
  const el = createDiv();
  el.className = `text-icon-button tappable mod-pill empty-state-action ${MARKER_CLASS} ${action.cls}`;
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.setAttribute("aria-label", action.label);

  const iconEl = createSpan();
  iconEl.className = "text-button-icon";
  setIcon(iconEl, action.icon);
  el.appendChild(iconEl);

  const labelEl = createSpan();
  labelEl.className = "text-button-label";
  labelEl.textContent = action.label;
  el.appendChild(labelEl);

  el.addEventListener("click", (event) => action.onClick(event));
  el.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      action.onClick(event);
    }
  });
  return el;
}
