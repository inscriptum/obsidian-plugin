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
 * content — editing the text never breaks the target. Additive-format note:
 * the JSON shape ({type:"wikiLink", attrs:{path}} — a plain string attr) is
 * the safest additive form and older builds PRESERVE it on disk verbatim,
 * but prosemirror-model rejects unknown marks at LOAD time, so those builds
 * show a broken-content state instead of the link (schema version bump is
 * the owner's call — issue wikilinks).
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
    // highlighted span: the site never follows vault links, and the internal
    // vault path must not leak into the public HTML (no data attr, no title).
    // `path` comes from the schema attrs (default "") — typed explicitly
    // because the mark.attrs bag is untyped here.
    const path = String(mark.attrs.path ?? "");
    const hooks = this.options.hooks;
    const resolved = hooks?.isResolved(path) ?? true;
    return [
      "span",
      mergeAttributes(
        HTMLAttributes,
        hooks != null
          ? {
              class: resolved ? "texto-wikilink" : "texto-wikilink is-unresolved",
              "data-wiki-path": path,
              title: path,
            }
          : { class: "texto-wikilink" },
      ),
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
 *
 * Returning true stops PM's click protocol; the caret placement itself
 * happened natively on mousedown — a plain click on a link is navigation,
 * not caret placement (edit the display text via selection). A double-click
 * fires two clicks: the 500ms guard keeps the second one from re-opening.
 */
function clickToOpen(hooks: WikiHooks): Plugin {
  let lastOpen: { path: string; at: number } | null = null;
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
            const now = Date.now();
            if (lastOpen?.path !== path || now - lastOpen.at > 500) {
              lastOpen = { path, at: now };
              hooks.openTarget(path);
            }
          }
          return true;
        },
      },
    },
  });
}
