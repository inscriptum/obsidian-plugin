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
};

export interface MermaidOptions {
  HTMLAttributes?: Record<string, string>;
}

export type MermaidElementPublicProps = Omit<
  InstanceType<typeof MermaidElement>["props"],
  | "onEdit"
  | "onSave"
  | "onCancel"
  | "onInput"
  | keyof ElementComponentProps<unknown>
>;

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

      const setEditMode = (on: boolean) => {
        editing = on;
        element.classList.toggle("is-editing", on);
        if (on) {
          const input = textarea();
          if (input != null) {
            input.value = lastCode;
            setStatus(null);
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
      // committing guard blocks double-saves; the editing re-check after the
      // await means a Cancel/click-outside during the compile wins.
      const commitDraft = async (draft: string) => {
        if (!editing || committing) return;
        committing = true;
        setStatus(null);
        try {
          const svg = await renderMermaid(draft);
          if (!editing) return;
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
      element.props.onEdit = () => {
        if (!editor.isEditable || editing) return;
        setEditMode(true);
      };
      element.props.onSave = (draft: string) => {
        void commitDraft(draft);
      };
      element.props.onCancel = () => {
        if (editing) setEditMode(false);
      };
      element.props.onInput = (draft: string) => {
        scheduleParseHint(draft);
      };

      return {
        dom: element,

        // The editor face and the edit button are component-controlled: PM
        // must not react to their events. Everything else (clicks on the
        // diagram, drag) stays with ProseMirror for NodeSelection.
        stopEvent: (event) => {
          const target = event.target as Element | null;
          if (target?.closest?.(".mermaid-editor")) return true;
          if (target?.closest?.(".mermaid-view__edit")) return true;
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
          intersection?.disconnect();
          detachTheme?.();
        },
      };
    };
  },
});
