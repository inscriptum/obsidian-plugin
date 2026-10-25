import { Mark, mergeAttributes } from "../../core";
import type { EditorView } from "prosemirror-view";
import { Plugin, PluginKey } from "prosemirror-state";
import { wikiSuggestPlugin } from "./wikilinkSuggest";

/**
 * Hooks to the Obsidian vault, injected per host (NoteView / NotepadView)
 * through ExtensionHooks — src/texto stays Obsidian-independent. Absent
 * hooks switch the whole feature off: «[[» stays plain text, existing
 * wikiLink marks render as plain highlighted spans.
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
 * Internal link to a vault file (the «[[» links of Obsidian).
 *
 * The mark stores ONLY the target path; the display text is the mark's text
 * content — editing the text never breaks the target. The additive-mark
 * contract of the .note/.um format holds: older builds without this
 * extension preserve the unknown mark verbatim.
 */
export const WikiLink = Mark.create<WikiLinkOptions>({
  name: "wikiLink",

  keepOnSplit: false,

  exitable: true,

  inclusive: false,

  addOptions() {
    // NOTE: deliberately no `hooks` key here. mergeDeep() clones plain
    // objects key-by-key against the defaults, and a null/undefined default
    // would clone the injected hooks into an empty object (losing every
    // function — the same trap Image avoids by not declaring its hooks key).
    // Absent hooks = the feature is off.
    return {};
  },

  addAttributes() {
    return {
      path: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-wiki-path") ?? "",
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-wiki-path]" }];
  },

  renderHTML({ mark, HTMLAttributes }) {
    // Without hooks (the export schema) every link renders as a plain
    // highlighted span: the site never follows vault links. `path` comes
    // from the schema attrs (default "") — typed explicitly because the
    // mark.attrs bag is untyped here.
    const path = String(mark.attrs.path ?? "");
    const resolved = this.options.hooks?.isResolved(path) ?? true;
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: resolved ? "texto-wikilink" : "texto-wikilink is-unresolved",
        "data-wiki-path": path,
        title: path,
      }),
      0,
    ];
  },

  addProseMirrorPlugins() {
    const plugins: Plugin[] = [];
    const hooks = this.options.hooks;

    if (hooks) {
      plugins.push(clickToOpen(hooks));
      // The «[[» suggest popup rides on the same hooks (it must never exist
      // without a vault to suggest from).
      plugins.push(wikiSuggestPlugin(hooks));
    }

    return plugins;
  },
});

/**
 * Plain click on a wikiLink opens its target in the workspace — the same
 * contract the external link mark has (plain click follows the link).
 * Unresolved targets do nothing (no file creation, no crash).
 */
function clickToOpen(hooks: WikiHooks): Plugin {
  return new Plugin({
    key: new PluginKey("wikiLinkClick"),
    props: {
      handleDOMEvents: {
        click: (view: EditorView, event: MouseEvent) => {
          const target = event.target as HTMLElement | null;
          const el = target?.closest?.(".texto-wikilink");
          if (!el) return false;
          const path = el.getAttribute("data-wiki-path");
          if (path && hooks.isResolved(path)) {
            hooks.openTarget(path);
          }
          // Swallow the click either way: the caret does not belong inside
          // a link on a plain click (edit the display text via selection).
          return true;
        },
      },
    },
  });
}
