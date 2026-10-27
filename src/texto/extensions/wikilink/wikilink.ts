import { Extension, InputRule } from "../../core";
import {
  Plugin,
  PluginKey,
  TextSelection,
  NodeSelection,
} from "prosemirror-state";
import type { EditorState } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { Decoration, DecorationSet } from "prosemirror-view";
import { wikiSuggestKey, wikiSuggestPlugin } from "./wikilinkSuggest";

/**
 * Hooks to the Obsidian vault, injected per host (NoteView / NotepadView)
 * through ExtensionHooks — src/texto stays Obsidian-independent. Absent
 * hooks switch the whole feature off: «[[» stays plain text.
 */
export interface WikiFile {
  /** Vault-relative path with extension ("notes/plan.um"). */
  path: string;
  /** Basename without extension ("plan") — the default display text. */
  name: string;
}

export interface WikiHooks {
  /** All linkable files of the vault. */
  listFiles(): WikiFile[];
  /** Whether the path currently resolves to a vault file. */
  isResolved(path: string): boolean;
  /** Open the target in the workspace (current tab). */
  openTarget(path: string): void;
}

export interface WikiLinkOptions {
  hooks?: WikiHooks | null;
}

/**
 * Internal links, the ProseMirror way (owner direction, wikilinks round 7 —
 * the bold pattern instead of a 1:1 Obsidian copy): the raw «[[target|label]]»
 * syntax lives only while the link is being created. Typing «[[» opens the
 * suggest session over plain text; committing — Enter in the popup, a typed
 * closing «]]» or the caret leaving the pattern — consumes the syntax and
 * leaves the label text carrying the wikiLink mark (target in the mark
 * attrs). A committed link renders as its label only; re-entering it offers
 * the label for editing, the inside is fixed. No hidden decorations — the
 * whole class of display:none boundary bugs (rounds 3–6) is gone by design.
 */
export const WikiLink = Extension.create<WikiLinkOptions>({
  // NOT "wikiLink": that name belongs to the WikiLinkMark (the schema mark
  // whose name is stored in document JSON) — two extensions sharing a name
  // trips ExtensionManager's duplicate warning.
  name: "wikiLinkEditing",

  addOptions() {
    // NOTE: deliberately no `hooks` key here. mergeDeep() clones plain
    // objects key-by-key against the defaults, and a null/undefined default
    // would clone the injected hooks into an empty object (losing every
    // function — the same trap Image avoids by not declaring its hooks key).
    // Absent hooks = the feature is off.
    return {};
  },

  addInputRules() {
    if (!this.options.hooks) return [];
    return [
      // Typing «[[» auto-closes the link: «[[» + «]]» with the caret between
      // (the Obsidian behavior, owner round-4). The suggest popup opens on
      // the same transaction — its scan sees the caret before the closing
      // brackets. Undo (backspace through the rule's meta) removes the pair.
      new InputRule({
        find: /\[\[$/,
        handler: ({ state, range }): void => {
          // handled=true suppresses PM's insertion of the typed «[[» — the
          // rule inserts the FULL pair, caret between the brackets.
          state.tr.insertText("[[]]", range.from, range.to);
          state.tr.setSelection(
            TextSelection.create(state.tr.doc, range.from + 2),
          );
          // open the suggest session: only a freshly typed «[[» (or the
          // hover-menu Edit action) activates it
          state.tr.setMeta(wikiSuggestKey, { open: true });
        },
      }),
      // The tail of manually typed syntax (popup dismissed, no candidates,
      // no auto-closed pair around): the final «]» completing
      // «[[target|label]]» converts the pattern into a committed link —
      // the same consumption the bold input rule does to «**».
      new InputRule({
        find: /\[\[([^[|\]]+)(?:\|([^\][]*))?\]\]$/,
        handler: ({ state, range, match }): void => {
          commitPattern(state.tr, range.from, range.to, match[1] ?? "", match[2]);
          state.tr.setMeta(wikiSuggestKey, { close: true });
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    const plugins = [];
    const hooks = this.options.hooks;

    if (hooks) {
      plugins.push(wikiUnresolvedPlugin(hooks));
      plugins.push(finalizeOnExitPlugin());
      plugins.push(wikiLinkViewPlugin(hooks));
      // The «[[» suggest popup rides on the same hooks (it must never exist
      // without a vault to suggest from).
      plugins.push(wikiSuggestPlugin(hooks));
    }

    return plugins;
  },
});

/** Replace the raw pattern at [from, to) with the committed link: an
 *  INLINE ATOM node (owner «Способ 1») carrying the target and the label
 *  in its attrs. The caret is left where `tr`'s caller put it — this
 *  helper only maps it through the replacement. */
function commitPattern(
  tr: Transaction,
  from: number,
  to: number,
  target: string,
  display: string | null | undefined,
): void {
  const label = display != null && display.length > 0 ? display : target;
  tr.replaceWith(
    from,
    to,
    tr.doc.type.schema.nodes.wikiLink.create({ path: target, text: label }),
  );
}

/**
 * One complete `[[target]]` / `[[target|label]]` occurrence inside a single
 * text node — a raw pattern that is not a committed link yet (or a leftover
 * the caret abandoned).
 */
export interface WikiMatch {
  from: number;
  to: number;
  target: string;
  label: string | null;
}

/** All complete patterns within one text node (offsets are node-relative). */
export function scanWikiMatches(
  text: string,
): { start: number; end: number; target: string; label: string | null }[] {
  const out: { start: number; end: number; target: string; label: string | null }[] = [];
  const re = /\[\[([^[|]+)(?:\|([^[]*))?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    out.push({
      start: match.index,
      end: match.index + match[0].length,
      target: match[1] ?? "",
      label: match[2] ?? null,
    });
  }
  return out;
}

/** All raw patterns of the current document (doc positions). Pure — tested. */
export function findWikiMatches(state: EditorState): WikiMatch[] {
  const out: WikiMatch[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isText || typeof node.text !== "string") return true;
    for (const m of scanWikiMatches(node.text)) {
      out.push({
        from: pos + m.start,
        to: pos + m.end,
        target: m.target,
        label: m.label,
      });
    }
    return true;
  });
  return out;
}

/**
 * The hover-menu «Редактировать» action: a committed link dissolves back
 * into the raw «[[path|label]]» syntax with the caret at the end of the
 * path — the suggest popup reopens filtered by the current target (owner
 * round 7: editing shows the same menu as a fresh «[[»).
 */
export function startWikiEdit(view: EditorView, range: WikiLinkRange): void {
  const raw = `[[${range.path}|${range.label}]]`;
  const tr = view.state.tr;
  tr.replaceWith(range.from, range.to, tr.doc.type.schema.text(raw));
  tr.setSelection(
    TextSelection.create(tr.doc, range.from + 2 + range.path.length),
  );
  tr.setMeta(wikiSuggestKey, { open: true });
  view.dispatch(tr);
  view.focus();
}

/**
 * The hover-menu «Удалить» action: the link is replaced by its plain label
 * text — the same semantics as the trash button in the text bubble menu
 * (remove the LINK, keep the words). Undoable: a plain dispatched tr.
 */
export function removeWikiLink(view: EditorView, range: WikiLinkRange): void {
  const tr = view.state.tr;
  tr.replaceWith(
    range.from,
    range.to,
    tr.doc.type.schema.text(range.label),
  );
  tr.setSelection(
    TextSelection.create(tr.doc, range.from + range.label.length),
  );
  view.dispatch(tr);
  view.focus();
}

/**
 * Committed-link interactions (owner round 7 + review): a CLICK opens the
 * target right away (desktop and touch alike); HOVER shows a bubble menu
 * with «Перейти» / «Редактировать» / «Удалить» (desktop); Mod-click is the
 * same open. On touch, where no hover exists, a tap opens the menu — the
 * only way to reach its actions on a phone. Label editing and deletion
 * live in the menu's Edit / Delete actions.
 */
function wikiLinkViewPlugin(hooks: WikiHooks): Plugin {
  let menu: HTMLElement | null = null;
  let hideTimer = 0;

  const WIKI_MENU_NS = "http://www.w3.org/2000/svg";

  const menuIcon = (iconName: string): SVGSVGElement => {
    const svg = document.createElementNS(WIKI_MENU_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    const use = document.createElementNS(WIKI_MENU_NS, "use");
    use.setAttribute("href", `#inscriptum-tlb-${iconName}`);
    svg.appendChild(use);
    return svg;
  };

  const destroyMenu = () => {
    hideTimer = 0;
    menu?.remove();
    menu = null;
  };

  const scheduleHide = () => {
    if (menu == null || hideTimer !== 0) return;
    hideTimer = window.setTimeout(destroyMenu, 240);
  };

  const cancelHide = () => {
    if (hideTimer !== 0) {
      window.clearTimeout(hideTimer);
      hideTimer = 0;
    }
  };

  /** Open the suggest session on a committed link: the mark dissolves back
   *  into the raw «[[path|label]]» syntax with the caret at the end of the
   *  path (popup filtered by the current target, «|» reaches the label). */
  const startEdit = (view: EditorView, range: WikiLinkRange): void =>
    startWikiEdit(view, range);

  const showMenu = (view: EditorView, el: HTMLElement): void => {
    cancelHide();
    // Re-locate the mark from the live doc by the element's path: positions
    // may have shifted since the hover began, and the icon widget's own
    // rect resolves to the mark's boundary (where inclusive:false hides
    // it) — the data-wiki-path key is the only reliable one.
    const path =
      el.getAttribute("data-wiki-path") ??
      el.parentElement?.getAttribute("data-wiki-path") ??
      "";
    const range = path !== "" ? wikiLinkRangeByPath(view.state, path) : null;
    if (range == null) {
      destroyMenu();
      return;
    }
    const livePath = range.path;
    const resolved = hooks.isResolved(livePath);
    const rect = el.getBoundingClientRect();

    const previous = menu;
    if (previous != null) {
      cancelHide();
    } else {
      menu = createDiv("texto-wiki-hover");
      // Crossing the 4px gap onto the menu must not look like "left the
      // link": entering the menu cancels the hide, leaving it resumes.
      menu.addEventListener("mouseenter", cancelHide);
      menu.addEventListener("mouseleave", scheduleHide);
      document.body.appendChild(menu);
    }
    const box = menu!;

    const target = createSpan("texto-wiki-hover__path");
    if (!resolved) target.className += " is-unresolved";
    target.textContent = livePath;
    box.replaceChildren(target);

    const open = createDiv("texto-wiki-hover__item");
    open.appendChild(menuIcon("link"));
    open.setAttribute("aria-label", "Open wikilink target");
    open.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      destroyMenu();
      if (hooks.isResolved(livePath)) {
        hooks.openTarget(livePath);
      }
    });
    box.appendChild(open);

    const edit = createDiv("texto-wiki-hover__item");
    edit.appendChild(menuIcon("pencil"));
    edit.setAttribute("aria-label", "Edit wikilink");
    edit.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      destroyMenu();
      startEdit(view, range);
    });
    box.appendChild(edit);

    const del = createDiv("texto-wiki-hover__item");
    del.appendChild(menuIcon("trash"));
    del.setAttribute("aria-label", "Delete wikilink");
    del.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      destroyMenu();
      removeWikiLink(view, range);
    });
    box.appendChild(del);

    // Anchor under the link, clamped to the viewport.
    const margin = 8;
    const left = Math.min(
      Math.max(margin, rect.left),
      Math.max(margin, window.innerWidth - box.offsetWidth - margin),
    );
    let top = rect.bottom + 4;
    if (top + box.offsetHeight > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - box.offsetHeight - 4);
    }
    box.setAttribute(
      "style",
      `left:${left.toFixed(0)}px; top:${top.toFixed(0)}px;`,
    );
  };

  return new Plugin({
    key: new PluginKey("wikiLinkView"),
    props: {
      handleDOMEvents: {
        mousedown: (view: EditorView, event: MouseEvent) => {
          if (menu != null && !menu.contains(event.target as Node)) {
            destroyMenu();
          }
          const target = event.target as HTMLElement | null;
          const el = target?.closest?.(".texto-wikilink") as HTMLElement | null;
          if (!el) return false;
          const path =
            el.getAttribute("data-wiki-path") ??
            el.parentElement?.getAttribute("data-wiki-path") ??
            "";
          if (!window.matchMedia("(hover: hover)").matches) {
            // Touch: no hover exists, a tap opens the menu (the only way to
            // reach «Редактировать» on a phone). Click-to-open is desktop.
            event.preventDefault();
            showMenu(view, el);
            return true;
          }
          // Desktop: a click follows the link right away — owner review of
          // round 7 (Mod-click stays as the explicit habit).
          if (path && hooks.isResolved(path)) {
            hooks.openTarget(path);
          }
          event.preventDefault();
          return true;
        },
      },
      handleKeyDown: (view: EditorView, event: KeyboardEvent) => {
        if (event.key === "Escape" && menu != null) {
          destroyMenu();
        }
        return false;
      },
    },
    view(editorView) {
      const onBlurOut = () => {
        window.setTimeout(() => {
          const active = document.activeElement;
          if (!editorView.dom.contains(active) && menu != null) {
            destroyMenu();
          }
        }, 0);
      };
      // Hover lives on plain DOM listeners: ProseMirror forwards only a
      // fixed event set through handleDOMEvents — mouseover/mouseout are
      // not among them.
      const onMouseOver = (event: MouseEvent) => {
        if (!window.matchMedia("(hover: hover)").matches) return;
        const target = event.target as HTMLElement | null;
        const el = target?.closest?.(".texto-wikilink") as HTMLElement | null;
        if (el) showMenu(editorView, el);
      };
      const onMouseOut = (event: MouseEvent) => {
        if (menu == null) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest?.(".texto-wikilink") != null) {
          scheduleHide();
        }
      };
      // Scrolling under a floating menu leaves it pointing at the wrong
      // place — drop it (capture: the note scroller is an ancestor).
      const onScroll = () => destroyMenu();
      editorView.dom.addEventListener("focusout", onBlurOut);
      editorView.dom.addEventListener("mouseover", onMouseOver);
      editorView.dom.addEventListener("mouseout", onMouseOut);
      document.addEventListener("scroll", onScroll, true);
      return {
        destroy() {
          editorView.dom.removeEventListener("focusout", onBlurOut);
          editorView.dom.removeEventListener("mouseover", onMouseOver);
          editorView.dom.removeEventListener("mouseout", onMouseOut);
          document.removeEventListener("scroll", onScroll, true);
          destroyMenu();
        },
      };
    },
  });
}

/**
 * Commits a raw pattern the caret just LEFT (appendTransaction): while the
 * caret is inside the pattern the suggest session owns it (raw editing, as
 * in Obsidian); the transaction that moves the caret out is followed by one
 * that consumes the syntax into a committed link. Undo of an accept is not
 * an exit — the restored selection sits after the restored pattern, not
 * inside, so undo keeps working.
 */
function finalizeOnExitPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey("wikiLinkFinalize"),
    appendTransaction(transactions, oldState, newState) {
      // Exits are mostly selection-only transactions (click, arrows), so no
      // docChanged guard here — every dispatched transaction is checked.
      const oldSel = oldState.selection;
      const newSel = newState.selection;
      const matches = findWikiMatches(newState).filter((m) => {
        const wasInside = oldSel.from < m.to && oldSel.to > m.from;
        const isInside = newSel.from < m.to && newSel.to > m.from;
        return wasInside && !isInside;
      });
      if (matches.length === 0) return null;
      const tr = newState.tr;
      tr.setMeta("addToHistory", false);
      // Later positions first: each replacement shifts nothing before it.
      for (const match of matches.slice().sort((a, b) => b.from - a.from)) {
        commitPattern(tr, match.from, match.to, match.target, match.label);
      }
      return tr;
    },
  });
}

/**
 * Committed-link view decorations: the unresolved dim. The mini document
 * icon is NOT a decoration — it is drawn by CSS ::before on the mark's own
 * span (see editor.css), so it lives inside the link's inline box: the
 * caret and text typed before the link stay left of the icon, and nothing
 * extra overlays the line start (the drag handle zone).
 */
function wikiUnresolvedPlugin(hooks: WikiHooks): Plugin {
  return new Plugin({
    key: new PluginKey("wikiLinkUnresolved"),
    props: {
      decorations: (state) => {
        const decorations: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name !== "wikiLink") return true;
          if (!hooks.isResolved(String(node.attrs.path ?? ""))) {
            // An inline decoration over an atom node's range merges its
            // attributes into the node's own DOM span.
            decorations.push(
              Decoration.inline(pos, pos + node.nodeSize, {
                class: "is-unresolved",
              }),
            );
          }
          return true;
        });
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

/** True when the selection lives in wiki-link territory — an active suggest
 *  session (raw syntax on screen) or a selection touching a committed link
 *  (a NodeSelection over the atom, or a text selection covering it). The
 *  text bubble menu stays away from both (owner claim: no formatting
 *  controls inside «[[…]]» or over the rendered link). */
export function selectionInWikiContext(state: EditorState): boolean {
  if (wikiSuggestKey.getState(state)?.active === true) return true;
  const selection = state.selection;
  if (selection instanceof NodeSelection && selection.node.type.name === "wikiLink") {
    return true;
  }
  const { from, to } = selection;
  let found = false;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (found) return false;
    if (node.type.name === "wikiLink" && pos < to && pos + node.nodeSize > from) {
      found = true;
    }
    return !found;
  });
  return found;
}

/** The committed link (inline atom node) carrying exactly `path` (doc
 *  positions), or null. Position-independent: the element's
 *  data-wiki-path is the reliable key. */
export interface WikiLinkRange {
  from: number;
  to: number;
  path: string;
  label: string;
}

export function wikiLinkRangeByPath(
  state: EditorState,
  path: string,
): WikiLinkRange | null {
  let out: WikiLinkRange | null = null;
  state.doc.descendants((node, pos) => {
    if (out) return false;
    if (
      node.type.name === "wikiLink" &&
      String(node.attrs.path ?? "") === path
    ) {
      out = {
        from: pos,
        to: pos + node.nodeSize,
        path,
        label: String(node.attrs.text ?? ""),
      };
      return false;
    }
    return true;
  });
  return out;
}
