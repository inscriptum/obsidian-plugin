import { Extension } from "../../core";
import { Plugin, PluginKey } from "prosemirror-state";
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
    // Hide the opening part («[[target» and the pipe with a label prefix).
    const openEnd = match.label != null ? match.textFrom - 1 : match.textFrom;
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

/** Click on a rendered (decorated) link opens its target; raw text edits
 *  normally while the caret is inside. A double-click fires two clicks —
 *  the guard keeps the target from opening twice. */
function wikiDecorationsPlugin(hooks: WikiHooks): Plugin {
  let lastOpen: { path: string; at: number } | null = null;
  return new Plugin({
    key: new PluginKey("wikiLinkDecorations"),
    props: {
      decorations: (state) => buildWikiDecorations(state, hooks),
      handleDOMEvents: {
        click: (view: EditorView, event: MouseEvent) => {
          const target = event.target as HTMLElement | null;
          const el = target?.closest?.(".texto-wikilink");
          if (!el) return false;
          const path = el.getAttribute("data-wiki-path");
          if (path && hooks.isResolved(path)) {
            const now = Date.now();
            if (lastOpen?.path !== path || now - lastOpen.at > 500) {
              lastOpen = { path, at: now };
              hooks.openTarget(path);
            }
          }
          // The rendered label is navigation, not caret placement (the raw
          // syntax appears as soon as the caret enters the pattern).
          return true;
        },
      },
    },
  });
}
