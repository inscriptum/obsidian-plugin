import { isFunction, mergeAttributes, Node } from "../../core";
import { elTag } from "../../../tags";
import type { ElementComponentProps } from "@web-companions/gfc/@types";

import { addCommands } from "./commands";
import {
  mermaidErrorMessage,
  parseMermaid,
  parseSvgElement,
  renderMermaid,
} from "./mermaidApi";
import { onThemeChange } from "./theme";
import { mermaidElement } from "./view/mermaid.element";

export const VIEW_TAG = elTag("texto-extension-mermaid");
/** Static tag used in HTML serialization (clipboard/export) — stays version-independent. */
export const HTML_TAG = "texto-extension-mermaid";
export const MermaidElement = mermaidElement(VIEW_TAG);

export type MermaidOptionsAttrs = {
  /** Mermaid source of the diagram; the SVG is rendered from it, never stored. */
  code: string;
  /** Visual layout of the block (mirrors the image node's align). */
  align?: string | null;
};

export interface MermaidOptions {
  HTMLAttributes?: Record<string, string>;
}

export type MermaidElementPublicProps = Omit<
  InstanceType<typeof MermaidElement>["props"],
  | "onSave"
  | "onCancel"
  | "onInput"
  | keyof ElementComponentProps<unknown>
>;

/** DOM event the media bubble menu dispatches on the host element to open
 *  the inline source editor (see editMermaidDiagram in tools/media). */
export const MERMAID_EDIT_EVENT = "texto-mermaid-edit";

/** Visual layout of a diagram block (same set as ImageLayout). */
export type MermaidLayout =
  | "left"
  | "center"
  | "right"
  | "full"
  | "wrap-left"
  | "wrap-right";

export const MERMAID_LAYOUTS: MermaidLayout[] = [
  "left",
  "center",
  "right",
  "full",
  "wrap-left",
  "wrap-right",
];

function isMermaidLayout(value: unknown): value is MermaidLayout {
  return (
    typeof value === "string" &&
    MERMAID_LAYOUTS.includes(value as MermaidLayout)
  );
}

/** Applies the layout class to the host (left = default, no class) —
 *  the NodeView dom does not receive rendered attrs automatically. */
function syncLayoutClass(element: HTMLElement, align: unknown): void {
  const layout = isMermaidLayout(align) ? align : "left";
  for (const value of MERMAID_LAYOUTS) {
    if (value !== "left") {
      element.classList.toggle(`texto-mermaid-layout-${value}`, value === layout);
    }
  }
}

/** Debounce of the live parse hint while typing, ms. */
const LIVE_PARSE_DEBOUNCE_MS = 300;

/**
 * Mermaid diagram block.
 *
 * Dual-mode atom node: the view face renders the diagram to SVG from the
 * `code` attr (lazily, when the block scrolls into view; re-rendered on app
 * theme flips); the edit face is an inline source editor opened by the block's
 * pencil button. The document changes only on insert and on commit — a save
 * is one `setNodeMarkup` step, so undo stays coherent and a crash mid-edit
 * cannot store a half-state. Old plugin builds hit the read-only
 * broken-content guard on documents containing the node (no corruption).
 */
export const Mermaid = Node.create<MermaidOptions>({
  name: "mermaid",
  group: "block",

  atom: true,
  selectable: true,
  defining: true,
  draggable: false,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      code: {
        default: "",
        parseHTML: (element: HTMLElement) => element.dataset["code"] ?? "",
        renderHTML: (attributes: MermaidOptionsAttrs) => ({
          "data-code": attributes.code,
        }),
      },
      align: {
        default: "left",
        parseHTML: (element: HTMLElement) => element.dataset["align"],
        renderHTML: (attributes: MermaidOptionsAttrs) => ({
          "data-align": attributes.align,
        }),
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = mergeAttributes(this.options.HTMLAttributes ?? {}, HTMLAttributes);

    return [HTML_TAG, attrs];
  },

  parseHTML() {
    return [
      {
        tag: HTML_TAG,
      },
    ];
  },

  addCommands,

  addNodeView() {
    const element = new MermaidElement();
    element.addClass("texto-extension-mermaid-host");

    return ({ node, getPos, editor }) => {
      if (!isFunction(getPos)) {
        throw new Error("[TEXTO ERROR]: getPos must be a function.");
      }

      let lastCode = node.attrs.code ?? "";
      let editing = false;
      let committing = false;
      let dirty = true;
      let visible = false;
      let renderToken = 0;
      let parseTimer: number | null = null;

      syncLayoutClass(element, node.attrs.align);

      const svgHost = () =>
        element.querySelector<HTMLElement>(".mermaid-view__svg");
      const messageHost = () =>
        element.querySelector<HTMLElement>(".mermaid-view__message");
      const statusHost = () =>
        element.querySelector<HTMLElement>(".mermaid-editor__status");
      const textarea = () =>
        element.querySelector<HTMLTextAreaElement>(".mermaid-editor__input");

      const setMessage = (message: string | null) => {
        const host = messageHost();
        if (host != null) host.textContent = message ?? "";
        element.classList.toggle("is-error", message != null);
      };

      const setStatus = (message: string | null) => {
        const host = statusHost();
        if (host != null) host.textContent = message ?? "";
        element.classList.toggle("has-status", message != null);
      };

      const setLoading = (on: boolean) => {
        element.classList.toggle("is-loading", on);
      };

      const mountSvg = (svg: string): boolean => {
        const host = svgHost();
        const root = parseSvgElement(svg);
        if (host == null) return false;
        if (root == null) {
          host.replaceChildren();
          return false;
        }
        host.replaceChildren(document.importNode(root, true));
        return true;
      };

      const renderNow = async () => {
        const token = (renderToken += 1);
        setLoading(true);
        try {
          const svg = await renderMermaid(lastCode);
          if (token !== renderToken) return;
          if (!mountSvg(svg)) {
            setMessage("The rendered diagram markup was not well-formed.");
          } else {
            setMessage(null);
          }
        } catch (error) {
          if (token !== renderToken) return;
          svgHost()?.replaceChildren();
          setMessage(mermaidErrorMessage(error));
        } finally {
          if (token === renderToken) setLoading(false);
        }
      };

      const maybeRender = () => {
        if (visible && dirty && !editing) {
          dirty = false;
          void renderNow();
        }
      };

      // Lazy first paint: render when the block scrolls into view. Without
      // IntersectionObserver (jsdom tests) the block simply never renders.
      let intersection: IntersectionObserver | null = null;
      let detachTheme: (() => void) | null = null;
      if (typeof IntersectionObserver === "function") {
        intersection = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            visible = entry.isIntersecting;
            if (visible) maybeRender();
          }
        });
        intersection.observe(element);
        detachTheme = onThemeChange(() => {
          dirty = true;
          maybeRender();
        });
      }

      // Each entry into the edit face opens a new editing session: an
      // in-flight save from a previous session must not land after the user
      // cancelled, re-opened and started typing a fresh draft.
      let editSession = 0;

      const setEditMode = (on: boolean) => {
        editing = on;
        if (on) editSession += 1;
        element.classList.toggle("is-editing", on);
        if (on) {
          const input = textarea();
          if (input != null) {
            input.value = lastCode;
            setStatus(null);
            // The element's input handler mirrors the draft into the code
            // block backdrop rows.
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.focus();
          }
        } else if (editor.isEditable) {
          editor.view.focus();
          maybeRender();
        }
      };

      // Save = one compile attempt; on failure the error lands in the status
      // line and the draft stays open. On success the SVG is painted at once,
      // then the source is stored — a single undoable document step. The
      // committing guard blocks double-saves; after the await the save only
      // lands if the SAME editing session is still open (an explicit Cancel —
      // or a Cancel + re-open with a fresh draft — during the compile wins).
      const commitDraft = async (draft: string) => {
        if (!editing || committing) return;
        committing = true;
        const session = editSession;
        setStatus(null);
        try {
          const svg = await renderMermaid(draft);
          if (!editing || editSession !== session) return;
          renderToken += 1; // invalidate any in-flight view render (theme flip)
          if (!mountSvg(svg)) {
            setStatus("The rendered diagram markup was not well-formed.");
            return;
          }
          setMessage(null);
          lastCode = draft;
          dirty = false;

          // Live position at commit time — the captured one goes stale when
          // content before the block changes.
          const pos = getPos();
          const currentNode =
            typeof pos === "number"
              ? editor.state.doc.nodeAt(pos)
              : null;
          if (typeof pos !== "number" || currentNode?.type !== this.type) {
            setEditMode(false);
            return;
          }
          editor.view.dispatch(
            editor.view.state.tr.setNodeMarkup(pos, undefined, {
              ...(currentNode.attrs as MermaidOptionsAttrs),
              code: draft,
            }),
          );
          setEditMode(false);
        } catch (error) {
          if (editing) setStatus(mermaidErrorMessage(error));
        } finally {
          committing = false;
        }
      };

      // Live hint: cheap parse with a debounce; the expensive render waits
      // for an explicit save.
      const scheduleParseHint = (draft: string) => {
        if (parseTimer != null) window.clearTimeout(parseTimer);
        parseTimer = window.setTimeout(() => {
          parseTimer = null;
          void parseMermaid(draft)
            .then(() => {
              if (editing) setStatus(null);
            })
            .catch((error: unknown) => {
              if (editing) setStatus(mermaidErrorMessage(error));
            });
        }, LIVE_PARSE_DEBOUNCE_MS);
      };

      element.classList.toggle("is-readonly", !editor.isEditable);
      element.props.onSave = (draft: string) => {
        void commitDraft(draft);
      };
      element.props.onCancel = () => {
        if (editing) setEditMode(false);
      };
      element.props.onInput = (draft: string) => {
        scheduleParseHint(draft);
      };

      // The media bubble menu's "Edit diagram" button asks this node view to
      // open its inline editor via a DOM event on the host element.
      const onEditEvent = () => {
        if (!editor.isEditable || editing) return;
        setEditMode(true);
      };
      element.addEventListener(MERMAID_EDIT_EVENT, onEditEvent);

      return {
        dom: element,

        // The editor face is component-controlled: PM must not react to its
        // events. Everything else (clicks on the diagram, drag) stays with
        // ProseMirror for NodeSelection.
        stopEvent: (event) => {
          const target = event.target as Element | null;
          if (target?.closest?.(".mermaid-editor")) return true;
          return false;
        },

        // The whole subtree is component-controlled; node changes arrive
        // through update().
        ignoreMutation: () => true,

        update: (updatedNode) => {
          if (updatedNode.type !== this.type) {
            return false;
          }

          element.classList.toggle("is-readonly", !editor.isEditable);
          syncLayoutClass(element, updatedNode.attrs.align);

          const code = updatedNode.attrs.code ?? "";
          if (code !== lastCode) {
            lastCode = code;
            dirty = true;
            maybeRender();
          }
          // While editing, external attr changes (undo) do not clobber the
          // draft — it commits or discards on save/cancel.

          return true;
        },

        destroy: () => {
          if (parseTimer != null) window.clearTimeout(parseTimer);
          element.removeEventListener(MERMAID_EDIT_EVENT, onEditEvent);
          intersection?.disconnect();
          detachTheme?.();
        },
      };
    };
  },
});
