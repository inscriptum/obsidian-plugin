import { Extension, InputRule } from "../../core";
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { EditorState } from "prosemirror-state";
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
 * Internal links, the Obsidian inline-syntax model (owner decision,
 * issue wikilinks round 3): the document stores `[[target|label]]` (or
 * `[[target]]`) as PLAIN TEXT. While the caret is outside a complete
 * pattern, decorations render it as a styled link label (brackets, target
 * and pipe hidden); with the caret inside, the raw syntax shows for
 * editing. No mark in the JSON — the format stays plain text, older builds
 * see normal text and the export post-processes the same pattern.
 */
export const WikiLink = Extension.create<WikiLinkOptions>({
  name: "wikiLink",

  addOptions() {
    // NOTE: deliberately no `hooks` key here. mergeDeep() clones plain
    // objects key-by-key against the defaults, and a null/undefined default
    // would clone the injected hooks into an empty object (losing every
    // function — the same trap Image avoids by not declaring its hooks key).
    // Absent hooks = the feature is off.
    return {};
  },

  addInputRules() {
    // Typing «[[» auto-closes the link: «[[» + «]]» with the caret between
    // (the Obsidian behavior, owner round-4). The suggest popup opens on
    // the same transaction — its scan sees the caret before the closing
    // brackets. Undo (backspace through the rule's meta) removes the pair.
    if (!this.options.hooks) return [];
    return [
      new InputRule({
        find: /\[\[$/,
        handler: ({ state, range }): void => {
          // handled=true suppresses PM's insertion of the typed «[[» — the
          // rule inserts the FULL pair, caret between the brackets.
          state.tr.insertText("[[]]", range.from, range.to);
          state.tr.setSelection(
            TextSelection.create(state.tr.doc, range.from + 2),
          );
          // open the suggest session: only a freshly typed «[[» activates it
          // (re-entering raw syntax with arrows or the edit menu does not —
          // owner round-6, the popup lingering after editing)
          state.tr.setMeta(wikiSuggestKey, { open: true });
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    const plugins = [];
    const hooks = this.options.hooks;

    if (hooks) {
      plugins.push(wikiDecorationsPlugin(hooks));
      // The «[[» suggest popup rides on the same hooks (it must never exist
      // without a vault to suggest from).
      plugins.push(wikiSuggestPlugin(hooks));
    }

    return plugins;
  },
});

/**
 * One complete `[[target]]` / `[[target|label]]` occurrence inside a single
 * text node.
 */
export interface WikiMatch {
  from: number;
  to: number;
  /** Document position of the rendered link text (label, or target when no
   *  label is present). */
  textFrom: number;
  textTo: number;
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

/** All matches of the current document (doc positions). Pure — tested. */
export function findWikiMatches(state: EditorState): WikiMatch[] {
  const out: WikiMatch[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isText || typeof node.text !== "string") return true;
    for (const m of scanWikiMatches(node.text)) {
      // The visible link text: the label when present, otherwise the target
      // (both sit right before the closing brackets).
      const visible = m.label ?? m.target;
      const textTo = pos + m.end - 2;
      out.push({
        from: pos + m.start,
        to: pos + m.end,
        textFrom: textTo - visible.length,
        textTo,
        target: m.target,
        label: m.label,
      });
    }
    return true;
  });
  return out;
}

/** Whether the selection reaches INTO the pattern (then it renders raw).
 *  A collapsed caret sitting exactly on a boundary (right before «[[» or
 *  right after «]]») does NOT count — the link stays rendered. */
function selectionOverlaps(state: EditorState, match: WikiMatch): boolean {
  const { from, to } = state.selection;
  return from < match.to && to > match.from;
}

function buildWikiDecorations(state: EditorState, hooks: WikiHooks): DecorationSet {
  const decorations: Decoration[] = [];
  for (const match of findWikiMatches(state)) {
    if (selectionOverlaps(state, match)) continue;
    // Hide the opening part («[[target» + the pipe when a label follows).
    const openEnd = match.textFrom;
    decorations.push(
      Decoration.inline(
        match.from,
        openEnd,
        { class: "texto-wiki-hide" },
        { wikiHide: true },
      ),
    );
    // Hide the closing brackets.
    decorations.push(
      Decoration.inline(
        match.textTo,
        match.to,
        { class: "texto-wiki-hide" },
        { wikiHide: true },
      ),
    );
    // Style the visible link text.
    const resolved = hooks.isResolved(match.target);
    decorations.push(
      Decoration.inline(
        match.textFrom,
        match.textTo,
        {
          class: resolved ? "texto-wikilink" : "texto-wikilink is-unresolved",
          "data-wiki-path": match.target,
        },
        { wikiLink: true },
      ),
    );
  }
  return DecorationSet.create(state.doc, decorations);
}

/**
 * Rendered-link click semantics (owner round-5, Notion-style): a click on a
 * rendered label does NOT change its view — a mini bubble menu appears with
 * «Редактировать» (caret inside the pattern → the raw syntax shows) and
 * «Перейти» (open the target). */
function wikiDecorationsPlugin(hooks: WikiHooks): Plugin {
  let menu: HTMLElement | null = null;

  const destroyMenu = () => {
    menu?.remove();
    menu = null;
  };

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

  const showMenu = (view: EditorView, el: HTMLElement): void => {
    destroyMenu();
    menu = createDiv("texto-wiki-menu");
    document.body.appendChild(menu);

    // Icon buttons (owner round-6: no text labels, bubble-menu style).
    // Pencil → caret inside the pattern at the clicked spot (raw edit);
    // link → open the target. The click coords ride on the element's
    // data attributes (the label IS doc text, so posAtCoords maps them
    // inside the pattern).
    const edit = createDiv("texto-wiki-menu__item");
    edit.appendChild(menuIcon("pencil"));
    edit.setAttribute("aria-label", "Edit wikilink");
    edit.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const cx = parseFloat(el.getAttribute("data-click-x") ?? "0");
      const cy = parseFloat(el.getAttribute("data-click-y") ?? "0");
      const pos = view.posAtCoords({ left: cx, top: cy });
      if (pos) {
        view.dispatch(
          view.state.tr
            .setSelection(TextSelection.create(view.state.doc, pos.pos))
            .setMeta("pointer", true),
        );
      }
      destroyMenu();
      view.focus();
    });
    menu.appendChild(edit);

    const open = createDiv("texto-wiki-menu__item");
    open.appendChild(menuIcon("link"));
    open.setAttribute("aria-label", "Open target");
    open.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const path = el.getAttribute("data-wiki-path") ?? "";
      if (hooks.isResolved(path)) {
        hooks.openTarget(path);
      }
      destroyMenu();
    });
    menu.appendChild(open);

    // Anchor under the clicked link, clamped to the viewport.
    const lr = el.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(
      Math.max(margin, lr.left),
      Math.max(margin, window.innerWidth - menu.offsetWidth - margin),
    );
    const top = lr.bottom + 4;
    menu.setAttribute(
      "style",
      `left:${left.toFixed(0)}px; top:${top.toFixed(0)}px;`,
    );
  };

  return new Plugin({
    key: new PluginKey("wikiLinkDecorations"),
    props: {
      decorations: (state) => buildWikiDecorations(state, hooks),
      // A space typed on a pattern BOUNDARY (the caret right before the
      // hidden «[[» or right after the hidden «]]») is inserted explicitly:
      // the browser's default insertion point skips display:none spans, so
      // the space would land INSIDE the pattern (owner round-5). A space
      // typed strictly inside the pattern closes the link (space after the
      // brackets — the owner model).
      handleTextInput: (view: EditorView, from: number, to: number, text: string) => {
        if (text !== " ") return false;
        const match = findWikiMatches(view.state).find(
          (m) => from > m.from && from < m.to,
        );
        if (match == null) return false;
        const tr = view.state.tr;
        tr.insertText(" ", match.to, match.to);
        tr.setSelection(TextSelection.create(tr.doc, match.to + 1));
        tr.setMeta(wikiSuggestKey, { close: true });
        tr.setMeta("pointer", true);
        view.dispatch(tr);
        view.focus();
        return true;
      },
      handleKeyDown: (view: EditorView, event: KeyboardEvent) => {
        if (event.key !== " " || !view.state.selection.empty) return false;
        const caret = view.state.selection.from;
        const match = findWikiMatches(view.state).find(
          (m) => caret === m.from || caret === m.to,
        );
        if (match == null) return false;
        // The caret hugs a hidden bracket — insert the space on the OUTSIDE
        // of the pattern (before «[[» from the left edge, after «]]» from
        // the right edge) so it stays visible.
        const insertAt = caret === match.from ? match.from : match.to;
        event.preventDefault();
        const tr = view.state.tr;
        tr.insertText(" ", insertAt, insertAt);
        tr.setSelection(TextSelection.create(tr.doc, insertAt + 1));
        view.dispatch(tr);
        view.focus();
        return true;
      },
      handleDOMEvents: {
        // The whole interaction lives on mousedown: preventDefault stops
        // PM's caret placement (which would instantly reveal the raw
        // syntax — the owner wants the view unchanged until an action is
        // chosen), and the mini menu shows in place of the swap.
        mousedown: (view: EditorView, event: MouseEvent) => {
          if (menu != null && !menu.contains(event.target as Node)) {
            destroyMenu();
          }
          const target = event.target as HTMLElement | null;
          const el = target?.closest?.(".texto-wikilink") as HTMLElement | null;
          if (!el) return false;
          if (event.metaKey || event.ctrlKey) {
            // Modifier-click is the direct shortcut for following the link.
            const path = el.getAttribute("data-wiki-path");
            if (path && hooks.isResolved(path)) {
              hooks.openTarget(path);
            }
            event.preventDefault();
            return true;
          }
          event.preventDefault();
          el.setAttribute("data-click-x", String(event.clientX));
          el.setAttribute("data-click-y", String(event.clientY));
          showMenu(view, el);
          return true;
        },
      },
    },
  });
}
