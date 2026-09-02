import { litView } from "@web-companions/lit";
import { p } from "@web-companions/gfc";
import type { Instance } from "tippy.js";
import { Editor, isTextSelection, posToDOMRect } from "../../texto/core";
import { elTag } from "../../tags";
import type { BubbleMenuPluginState } from "../../texto/extensions/bubble-menu/bubble-menu-plugin";
import { getBubbleMenuState, TEXT_COLORS, type BubbleMenuState } from "./bubbleMenuState";
import { bubbleIconNodes } from "./icons.svgnode";

type OpenLayer = "styles" | "link" | null;

const cls = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

const HEADING_LEVEL: Record<"h1" | "h2" | "h3", 1 | 2 | 3> = { h1: 1, h2: 2, h3: 3 };

type MarkAction = "bold" | "italic" | "underline" | "strike" | "code" | "mark";
type BlockAction = "paragraph" | "h1" | "h2" | "h3" | "quote" | "list" | "taskList";

/**
 * Full-featured bubble menu based on the docs/design/Bubble-Menu-Prototype design:
 * a row of inline formats (B I U S code marker | Aa | link | clear formatting),
 * a "Styles & color" layer (blocks + palette) and a "Link" layer (URL input).
 *
 * Positions the menu via tippy.js (bubbleMenuPlugin); here — content, layers,
 * active states, keyboard (Esc, ⌘K), and a caret pointing to the selection center.
 */
export const BubbleMenuBarElement = litView.element({
  props: {
    editor: p.req<Editor>(),
  },
})(function* (props) {
  let state: BubbleMenuState = getBubbleMenuState(props.editor);
  let openLayer: OpenLayer = null;
  let linkDraft = "";
  let lastSelKey = "";

  // eslint-disable-next-line @typescript-eslint/no-this-alias -- generator component: needs external this reference for rAF/handlers
  const root: HTMLElement = this;
  const barEl = () => root.querySelector<HTMLElement>(".bubble-menu-bar")!;

  // Mobile (phone/tablet): the keyboard hints (Enter/Esc) are meaningless —
  // there are no such keys on touch devices, so the link layer renders
  // without the kbd footer. Detected once: the host does not move between
  // mobile and desktop containers during a view's lifetime.
  const isMobileContext =
    root.closest(".note-view-container.is-mobile, .mobile-navbar") != null;

  /** Plugin instances expose a private `key` field holding the PluginKey name. */
  type KeyedPlugin = { key?: { key?: string } };

  const wiredTippies = new WeakSet<Instance>();

  /* ── Access to tippy instance (stored in bubbleMenu plugin state) ── */
  const getTippy = (): Instance | undefined => {
    if (props.editor.isDestroyed) return undefined;
    const es = props.editor.state;
    for (const plugin of es.plugins) {
      const key = (plugin as KeyedPlugin).key?.key;
      if (key === "bubbleMenu") {
        return (plugin.getState(es) as BubbleMenuPluginState | undefined)?.tippy;
      }
    }
    return undefined;
  };

  /* ── Layers ── */
  const closeLayer = () => {
    if (openLayer) {
      openLayer = null;
      void this.next();
    }
  };

  const placeLayerCaret = (layerSel: string, btnSel: string) => {
    const layer = barEl().querySelector<HTMLElement>(layerSel);
    const btn = barEl().querySelector<HTMLElement>(btnSel);
    if (!layer || !btn) return;
    const bar = barEl();
    const bx = btn.offsetLeft + btn.offsetWidth / 2;
    const lw = layer.offsetWidth;
    const caret = Math.max(14, Math.min(lw - 14, bx - (bar.offsetWidth - lw)));
    layer.style.setProperty("--caret-left", `${caret}px`);
  };

  /**
   * Layer open direction: tippy only accounts for the menu bar height,
   * but the layer is taller — measure available screen space and open
   * the layer where it fits (up by default, down if there's room below).
   */
  const placeLayerDirection = (layerSel: string) => {
    window.requestAnimationFrame(() => {
      const bar = barEl();
      const layer = bar.querySelector<HTMLElement>(layerSel);
      if (!layer) return;
      const barRect = bar.getBoundingClientRect();
      const layerHeight = layer.offsetHeight;
      const gap = 9; // calc(100% + 9px)
      const spaceAbove = barRect.top;
      const spaceBelow = window.innerHeight - barRect.bottom;
      let openUp: boolean;
      if (spaceAbove >= layerHeight + gap) {
        openUp = true;
      } else if (spaceBelow >= layerHeight + gap) {
        openUp = false;
      } else {
        openUp = spaceAbove >= spaceBelow;
      }
      bar.classList.toggle("layer-open-down", !openUp);
      // Mobile only: cap the layer height to the space available on its side so
      // it can never extend off-screen — e.g. on a short/landscape viewport where
      // the bar sits near the screen bottom and the layer opens upward, its top
      // would otherwise clip above the viewport (top items unreachable). Desktop
      // keeps the natural layer height (floating popup, no scrolling).
      if (isMobileContext) {
        const available = (openUp ? spaceAbove : spaceBelow) - gap - 8;
        layer.style.maxHeight = `${Math.max(140, Math.min(window.innerHeight - 24, available))}px`;
      }
    });
  };

  const toggleStylesLayer = () => {
    openLayer = openLayer === "styles" ? null : "styles";
    void this.next().then(() => {
      window.requestAnimationFrame(() => {
        placeLayerCaret(".bubble-menu-layer--styles", '[data-bb-action="styles"]');
        placeLayerDirection(".bubble-menu-layer--styles");
      });
    });
  };

  const openLinkLayer = () => {
    const sel = props.editor.state.selection;
    if (sel.from === sel.to || !isTextSelection(sel)) return;
    const attrs = props.editor.getAttributes("link");
    linkDraft = typeof attrs.href === "string" ? attrs.href : "";
    openLayer = "link";
    void this.next().then(() => {
      window.requestAnimationFrame(() => {
        const input = barEl().querySelector<HTMLInputElement>(".bubble-menu-link-input");
        input?.focus();
        input?.select();
        placeLayerCaret(".bubble-menu-layer--link", '[data-bb-action="link"]');
      });
    });
  };

  const toggleLinkLayer = () => {
    if (openLayer === "link") {
      closeLayer();
      return;
    }
    openLinkLayer();
  };

  /** Remove the link mark from the current selection (trash button).
   * unsetLink is not exposed in the ChainedCommands type (see applyLink),
   * so use its underlying equivalent: unsetMark('link', extendEmptyMarkRange). */
  const removeLink = () => {
    const sel = props.editor.state.selection;
    if (!sel.empty && isTextSelection(sel)) {
      props.editor
        .chain()
        .focus()
        .unsetMark("link", { extendEmptyMarkRange: true })
        .setMeta("preventAutolink", true)
        .run();
    }
    closeLayer();
  };

  const applyLink = () => {
    const url = linkDraft.trim();
    const sel = props.editor.state.selection;
    if (url && !sel.empty && isTextSelection(sel)) {
      // setLink from extensions/link is not exposed in ChainedCommands type —
      // use the equivalent chain from its addCommands:
      // chain().setMark('link', attrs).setMeta('preventAutolink', true).run()
      props.editor
        .chain()
        .focus()
        .setMark("link", { href: url })
        .setMeta("preventAutolink", true)
        .run();
    }
    closeLayer();
  };

  /* ── Formatting actions (selection is preserved: mousedown+preventDefault) ── */
  const applyMark = (mark: MarkAction) => {
    const e = props.editor;
    switch (mark) {
      case "bold":
        e.chain().focus().toggleBold().run();
        break;
      case "italic":
        e.chain().focus().toggleItalic().run();
        break;
      case "underline":
        e.chain().focus().toggleUnderline().run();
        break;
      case "strike":
        e.chain().focus().toggleStrike().run();
        break;
      case "code":
        e.chain().focus().toggleCode().run();
        break;
      case "mark":
        e.chain().focus().toggleHighlight().run();
        break;
    }
  };

  const applyBlock = (block: BlockAction) => {
    const e = props.editor;
    switch (block) {
      case "paragraph":
        e.chain().focus().clearNodes().run();
        break;
      case "h1":
      case "h2":
      case "h3":
        e.chain().focus().toggleHeading({ level: HEADING_LEVEL[block] }).run();
        break;
      case "quote":
        e.chain().focus().toggleBlockquote().run();
        break;
      case "list":
        e.chain().focus().toggleBulletList().run();
        break;
      case "taskList":
        e.chain().focus().toggleTaskList().run();
        break;
    }
  };

  const applyColor = (color: string | null) => {
    const e = props.editor;
    if (color == null) {
      e.chain().focus().unsetColor().run();
    } else {
      e.chain().focus().setColor(color).run();
    }
  };

  const clearFormatting = () => {
    props.editor.chain().focus().unsetAllMarks().run();
  };

  /* ── Selection center caret + flip (tippy flip) ── */
  const syncCaret = () => {
    const editor = props.editor;
    if (editor.isDestroyed || !editor.view) return;
    const { from, to } = editor.view.state.selection;
    // In table mode the selection is collapsed (caret in cell) — zero-width rect at caret
    const rect = posToDOMRect(editor.view, from, to);
    const bar = barEl();
    const barRect = bar.getBoundingClientRect();
    if (!barRect.width) return;
    const cx = rect.left + rect.width / 2;
    const caret = Math.max(20, Math.min(barRect.width - 20, cx - barRect.left));
    bar.style.setProperty("--caret-left", `${caret}px`);

    let box: HTMLElement | null = root.parentElement;
    while (box && !box.hasAttribute("data-placement")) {
      box = box.parentElement;
    }
    bar.classList.toggle("is-flip", box?.getAttribute("data-placement")?.startsWith("bottom") ?? false);
  };

  /* ── State update from editor events ── */
  const wireTippy = () => {
    const tippy = getTippy();
    if (tippy && !wiredTippies.has(tippy)) {
      wiredTippies.add(tippy);
      tippy.setProps({
        // Click outside / hide menu closes open layers
        onHide: () => {
          closeLayer();
        },
        onShow: () => {
          window.requestAnimationFrame(syncCaret);
        },
      });
    }
  };

  const refreshState = () => {
    if (props.editor.isDestroyed) return;
    state = getBubbleMenuState(props.editor);
    const sel = props.editor.state.selection;
    const selKey = `${sel.from}:${sel.to}`;
    if (selKey !== lastSelKey) openLayer = null;
    lastSelKey = selKey;
    wireTippy();
    void this.next();
    window.requestAnimationFrame(syncCaret);
  };

  /* ── Keyboard: Esc (layer → menu), ⌘K (link) ── */
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      const tippy = getTippy();
      if (!tippy || !tippy.state?.isVisible) return;
      e.preventDefault();
      e.stopPropagation();
      if (openLayer) {
        closeLayer();
        return;
      }
      tippy.hide();
      return;
    }

    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === "k" || e.key === "K")) {
      const sel = props.editor.state.selection;
      if (props.editor.isFocused && !sel.empty && isTextSelection(sel)) {
        e.preventDefault();
        e.stopPropagation();
        openLinkLayer();
      }
    }
  };

  props.editor.on("selectionUpdate", refreshState);
  props.editor.on("update", refreshState);
  document.addEventListener("keydown", onKeydown);

  try {
    while (true) {
      props = yield (
        <div class="bubble-menu-bar">
          <div class="bubble-menu-bar__row show">
            <button
              class={cls("bb-btn", state.bold && "is-active")}
              data-tip="Bold"
              data-kbd="⌘B"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyMark("bold")}
            >
              {bubbleIconNodes.bold()}
            </button>
            <button
              class={cls("bb-btn", state.italic && "is-active")}
              data-tip="Italic"
              data-kbd="⌘I"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyMark("italic")}
            >
              {bubbleIconNodes.italic()}
            </button>
            <button
              class={cls("bb-btn", state.underline && "is-active")}
              data-tip="Underline"
              data-kbd="⌘U"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyMark("underline")}
            >
              {bubbleIconNodes.underline()}
            </button>
            <button
              class={cls("bb-btn", state.strike && "is-active")}
              data-tip="Strikethrough"
              data-kbd="⌘⇧X"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyMark("strike")}
            >
              {bubbleIconNodes.strike()}
            </button>
            <button
              class={cls("bb-btn", state.code && "is-active")}
              data-tip="Inline code"
              data-kbd="⌘E"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyMark("code")}
            >
              {bubbleIconNodes.code()}
            </button>
            <button
              class={cls("bb-btn", state.mark && "is-active")}
              data-tip="Highlight"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyMark("mark")}
            >
              {bubbleIconNodes.mark()}
            </button>
            <span class="bubble-menu-sep"></span>
            <button
              class={cls("bb-btn", openLayer === "styles" && "is-active")}
              data-tip="Styles & color"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={toggleStylesLayer}
            >
              <span class="bb-aa">Aa</span>
            </button>
            <button
              class={cls("bb-btn", (openLayer === "link" || state.link) && "is-active")}
              data-tip="Link"
              data-kbd="⌘K"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={toggleLinkLayer}
            >
              {bubbleIconNodes.link()}
            </button>
            <span class="bubble-menu-sep"></span>
            <button
              class="bb-btn"
              data-tip="Clear formatting"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={clearFormatting}
            >
              {bubbleIconNodes.clear()}
            </button>
          </div>

          <span class="bb-caret"></span>

          {/* "Styles & color" layer — pops up above the menu */}
          <div
            class={cls("bubble-menu-layer", "bubble-menu-layer--styles", openLayer === "styles" && "show")}
            role="dialog"
            aria-label="Text styles & color"
          >
            <span class="bb-layer-caret"></span>
            <div class="bb-layer-label">Block</div>
            <button
              class={cls("bb-mi", state.paragraph && "is-active")}
              aria-label="Paragraph"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyBlock("paragraph")}
            >
              {bubbleIconNodes.paragraph()}
              <span>Paragraph</span>
              <span class="bb-tick">{bubbleIconNodes.check()}</span>
            </button>
            <button
              class={cls("bb-mi", "bb-mi--h1", state.h1 && "is-active")}
              aria-label="Heading 1"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyBlock("h1")}
            >
              {bubbleIconNodes.h1()}
              <span>Heading 1</span>
              <span class="bb-tick">{bubbleIconNodes.check()}</span>
            </button>
            <button
              class={cls("bb-mi", "bb-mi--h2", state.h2 && "is-active")}
              aria-label="Heading 2"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyBlock("h2")}
            >
              {bubbleIconNodes.h2()}
              <span>Heading 2</span>
              <span class="bb-tick">{bubbleIconNodes.check()}</span>
            </button>
            <button
              class={cls("bb-mi", "bb-mi--h3", state.h3 && "is-active")}
              aria-label="Heading 3"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyBlock("h3")}
            >
              {bubbleIconNodes.h3()}
              <span>Heading 3</span>
              <span class="bb-tick">{bubbleIconNodes.check()}</span>
            </button>
            <button
              class={cls("bb-mi", state.quote && "is-active")}
              aria-label="Blockquote"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyBlock("quote")}
            >
              {bubbleIconNodes.blockquote()}
              <span>Blockquote</span>
              <span class="bb-tick">{bubbleIconNodes.check()}</span>
            </button>
            <button
              class={cls("bb-mi", state.list && "is-active")}
              aria-label="List"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyBlock("list")}
            >
              {bubbleIconNodes.list()}
              <span>List</span>
              <span class="bb-tick">{bubbleIconNodes.check()}</span>
            </button>
            <button
              class={cls("bb-mi", state.taskList && "is-active")}
              aria-label="Checkbox"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyBlock("taskList")}
            >
              {bubbleIconNodes.taskList()}
              <span>Checkbox</span>
              <span class="bb-tick">{bubbleIconNodes.check()}</span>
            </button>

            <div class="bb-layer-sep"></div>
            <div class="bb-layer-label">Text color</div>
            <div class="bb-sw-row">
              {TEXT_COLORS.map((sw) => (
                <button
                  class={cls("bb-sw", `bb-sw--${sw.css}`, (sw.color ?? null) === state.color && "is-active")}
                  aria-label={sw.label}
                  onmousedown={(e: MouseEvent) => e.preventDefault()}
                  onclick={() => applyColor(sw.color)}
                ></button>
              ))}
            </div>
          </div>

          {/* "Link" layer — expands below the menu */}
          <div
            class={cls("bubble-menu-layer", "bubble-menu-layer--link", openLayer === "link" && "show")}
            role="dialog"
            aria-label="Insert link"
          >
            <span class="bb-layer-caret"></span>
            <div class="bb-link-row">
              <input
                class="bubble-menu-link-input"
                type="url"
                placeholder="https://…"
                spellcheck="false"
                aria-label="Link URL"
                value={linkDraft}
                oninput={(e: Event) => {
                  linkDraft = (e.target as HTMLInputElement).value;
                }}
                onkeydown={(e: KeyboardEvent) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applyLink();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    closeLayer();
                  }
                }}
              />
              <button
                class="bb-go"
                aria-label="Apply link"
                onmousedown={(e: MouseEvent) => e.preventDefault()}
                onclick={applyLink}
              >
                {bubbleIconNodes.check()}
              </button>
              <button
                class="bb-go bb-del"
                aria-label="Remove link"
                onmousedown={(e: MouseEvent) => e.preventDefault()}
                onclick={removeLink}
              >
                {bubbleIconNodes.trash()}
              </button>
            </div>
            {/* Keyboard hints are desktop-only: touch devices (phones, tablets)
                have no Enter/Esc keys and no way to trigger them. */}
            {isMobileContext ? null : (
              <div class="bb-link-foot">
                <kbd>Enter</kbd> apply · <kbd>Esc</kbd> cancel
              </div>
            )}
          </div>

        </div>
      );
    }
  } finally {
    props.editor.off("selectionUpdate", refreshState);
    props.editor.off("update", refreshState);
    document.removeEventListener("keydown", onKeydown);
  }
})(elTag("bubble-menu-bar"));
