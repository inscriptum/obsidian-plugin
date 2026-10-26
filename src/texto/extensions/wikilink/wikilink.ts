import { Extension, InputRule } from "../../core";
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { wikiSuggestPlugin } from "./wikilinkSuggest";

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

  const showMenu = (view: EditorView, el: HTMLElement, clickX: number, clickY: number): void => {
    destroyMenu();
    menu = createDiv("texto-wiki-menu");
    document.body.appendChild(menu);

    const path = el.getAttribute("data-wiki-path") ?? "";

    const edit = createDiv("texto-wiki-menu__item");
    edit.textContent = "Редактировать";
    edit.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      // Map the click to a document position inside the pattern (the label
      // is real doc text) — the raw syntax shows right at that spot.
      const pos = view.posAtCoords({ left: clickX, top: clickY });
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
    open.textContent = "Перейти";
    open.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
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
          showMenu(view, el, event.clientX, event.clientY);
          return true;
        },
      },
    },
  });
}
