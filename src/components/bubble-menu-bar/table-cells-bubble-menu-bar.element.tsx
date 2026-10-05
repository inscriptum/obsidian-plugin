import type { Instance } from "tippy.js";
import { litView } from "@web-companions/lit";
import { p } from "@web-companions/gfc";
import { Editor, posToDOMRect } from "../../texto/core";
import { CellSelection } from "prosemirror-tables";
import { elTag } from "../../tags";
import type { BubbleMenuPluginState } from "../../texto/extensions/bubble-menu/bubble-menu-plugin";
import {
  getTableMenuState,
  isHexColor,
  pickerHexValue,
} from "./tableMenuState";
import { getBubbleMenuState, TEXT_COLORS } from "./bubbleMenuState";
import { bubbleIconNodes } from "./icons.svgnode";

type OpenLayer = "table-color" | "link" | null;

const cls = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");

type MarkAction = "bold" | "italic" | "underline" | "strike" | "code" | "mark";

/**
 * Floating bubble menu for a multi-cell table selection (CellSelection over
 * 2+ cells). Mirrors the text-selection formatting row — bold, italic,
 * underline, strike, inline code, highlight, text color, link, clear
 * formatting — applied to every selected cell: mark commands walk
 * selection.ranges (one range per cell), text color goes through
 * setCellsAttribute("dataColor"). Structural table actions and cell fill
 * live in the toolbar (see ToolbarElement.tableBar / the table panel);
 * block styles are deliberately absent — they are not text formatting and
 * must not touch cell structure.
 */
export const TableCellsBubbleMenuElement = litView.element({
  props: {
    editor: p.req<Editor>(),
    /** bubbleMenuPlugin key this element is attached to (tippy lookup). */
    pluginKey: p.opt<string>(),
  },
})(function* (props) {
  const pluginKey = () => props.pluginKey ?? "tableCellsBubbleMenu";
  let openLayer: OpenLayer = null;
  let linkDraft = "";
  let lastSelKey = "";

  // eslint-disable-next-line @typescript-eslint/no-this-alias -- generator component: needs external this reference for rAF/handlers
  const root: HTMLElement = this;
  const barEl = () => root.querySelector<HTMLElement>(".bubble-menu-bar")!;

  const closeLayer = () => {
    if (openLayer) {
      openLayer = null;
      void this.next();
    }
  };

  const placeLayerCaret = (layerSel: string, btnSel: string) => {
    const bar = barEl();
    if (!bar) return;
    const layer = bar.querySelector<HTMLElement>(layerSel);
    const btn = bar.querySelector<HTMLElement>(btnSel);
    if (!layer || !btn) return;
    const bx = btn.offsetLeft + btn.offsetWidth / 2;
    const lw = layer.offsetWidth;
    const caret = Math.max(14, Math.min(lw - 14, bx - (bar.offsetWidth - lw)));
    layer.style.setProperty("--caret-left", `${caret}px`);
  };

  const placeLayerDirection = (layerSel: string) => {
    window.requestAnimationFrame(() => {
      const bar = barEl();
      if (!bar) return;
      const layer = bar.querySelector<HTMLElement>(layerSel);
      if (!layer) return;
      const barRect = bar.getBoundingClientRect();
      const layerHeight = layer.offsetHeight;
      const gap = 9;
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
    });
  };

  const toggleTableColorLayer = () => {
    if (openLayer === "table-color") {
      closeLayer();
      return;
    }
    openLayer = "table-color";
    void this.next().then(() => {
      window.requestAnimationFrame(() => {
        placeLayerCaret(
          ".bubble-menu-layer--table-color",
          '[data-tbl="color"]',
        );
        placeLayerDirection(".bubble-menu-layer--table-color");
      });
    });
  };

  /* ── Formatting actions (selection is preserved: mousedown+preventDefault).
     Mark commands walk selection.ranges — CellSelection exposes one range
     per selected cell, so a toggle reaches every selected cell. ── */
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

  const applyCellTextColor = (color: string | null) => {
    props.editor
      .chain()
      .focus()
      .setCellsAttribute("dataColor", color ?? (null as unknown as string))
      .run();
  };

  const clearFormatting = () => {
    // unsetAllMarks removes marks over selection.ranges — every selected
    // cell; cell fill / dataColor attributes are not marks and stay.
    props.editor.chain().focus().unsetAllMarks().run();
  };

  /* ── Link layer (same behavior as the text bubble menu, for cells) ── */
  const openLinkLayer = () => {
    linkDraft = String(props.editor.getAttributes("link").href ?? "");
    openLayer = "link";
    void this.next().then(() => {
      window.requestAnimationFrame(() => {
        const input = barEl()?.querySelector<HTMLInputElement>(
          ".bubble-menu-link-input",
        );
        input?.focus();
        input?.select();
        placeLayerCaret(".bubble-menu-layer--link", '[data-tbl="link"]');
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

  const applyLink = () => {
    const url = linkDraft.trim();
    const sel = props.editor.state.selection;
    if (url && sel instanceof CellSelection) {
      props.editor
        .chain()
        .focus()
        .setMark("link", { href: url })
        .setMeta("preventAutolink", true)
        .run();
    }
    closeLayer();
  };

  const removeLink = () => {
    const sel = props.editor.state.selection;
    if (sel instanceof CellSelection) {
      props.editor
        .chain()
        .focus()
        .unsetMark("link", { extendEmptyMarkRange: true })
        .setMeta("preventAutolink", true)
        .run();
    }
    closeLayer();
  };

  const syncCaret = () => {
    const editor = props.editor;
    if (editor.isDestroyed || !editor.view) return;
    const { from, to } = editor.view.state.selection;
    const rect = posToDOMRect(editor.view, from, to);
    // The rAF can land while the element is detached or not yet rendered
    // (tippy move / generator restart) — there is nothing to sync then.
    const bar = barEl();
    if (!bar) return;
    const barRect = bar.getBoundingClientRect();
    if (!barRect.width) return;
    const cx = rect.left + rect.width / 2;
    const caret = Math.max(20, Math.min(barRect.width - 20, cx - barRect.left));
    bar.style.setProperty("--caret-left", `${caret}px`);

    let box: HTMLElement | null = root.parentElement;
    while (box && !box.hasAttribute("data-placement")) {
      box = box.parentElement;
    }
    bar.classList.toggle(
      "is-flip",
      box?.getAttribute("data-placement")?.startsWith("bottom") ?? false,
    );
  };

  /** Plugin instances expose a private `key` field holding the PluginKey name. */
  type KeyedPlugin = { key?: { key?: string } };

  const wiredTippies = new WeakSet<Instance>();

  const getTippy = (): Instance | undefined => {
    if (props.editor.isDestroyed) return undefined;
    const es = props.editor.state;
    for (const plugin of es.plugins) {
      const key = (plugin as KeyedPlugin).key?.key;
      if (key === pluginKey()) {
        return (plugin.getState(es) as BubbleMenuPluginState | undefined)
          ?.tippy;
      }
    }
    return undefined;
  };

  const wireTippy = () => {
    const tippy = getTippy();
    if (tippy && !wiredTippies.has(tippy)) {
      wiredTippies.add(tippy);
      tippy.setProps({
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
      if (
        props.editor.isFocused &&
        sel instanceof CellSelection &&
        getTableMenuState(props.editor.state).multiCell
      ) {
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
      const state = getBubbleMenuState(props.editor);
      // Only the text color is still relevant here — cell fill moved to the
      // table panel (data-tbl="color" button of the docked bar).
      const textColor = getTableMenuState(props.editor.state).textColor;
      props = yield (
        <div class="bubble-menu-bar">
          <div class="bubble-menu-cells-bar show">
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
              class={cls("bb-btn", openLayer === "table-color" && "is-active")}
              data-tbl="color"
              data-tip="Text color"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={toggleTableColorLayer}
            >
              <span class="bb-aa">Aa</span>
            </button>
            <button
              class={cls(
                "bb-btn",
                (openLayer === "link" || state.link) && "is-active",
              )}
              data-tbl="link"
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

          <div
            class={cls(
              "bubble-menu-layer",
              "bubble-menu-layer--table-color",
              openLayer === "table-color" && "show",
            )}
            role="dialog"
            aria-label="Text color"
          >
            <span class="bb-layer-caret"></span>
            <div class="bb-layer-label">Text color</div>
            {/* Unified palette (borders/fill picker): 12 swatches + the
               custom row. Swatch colors are inline styles — one source of
               truth (TEXT_COLORS), no per-color CSS classes. */}
            <div class="bb-dd-swatches">
              {TEXT_COLORS.map((sw) => (
                <button
                  class={cls(
                    "bb-sw",
                    sw.color == null && "bb-sw--none",
                    (sw.color ?? null) === textColor && "is-active",
                  )}
                  style={sw.color ? `background: ${sw.color}` : undefined}
                  aria-label={sw.label}
                  title={sw.label}
                  onmousedown={(e: MouseEvent) => e.preventDefault()}
                  onclick={() => applyCellTextColor(sw.color)}
                ></button>
              ))}
            </div>
            <div class="bb-layer-sep"></div>
            <div class="bb-dd-custom">
              <input
                type="color"
                value={pickerHexValue(textColor)}
                title="Custom color"
                onmousedown={(e: MouseEvent) => e.stopPropagation()}
                onchange={(e: Event) =>
                  applyCellTextColor((e.target as HTMLInputElement).value)
                }
              ></input>
              <input
                type="text"
                class="bb-dd-hex"
                placeholder="#rrggbb"
                maxlength={7}
                spellcheck={false}
                aria-label="Custom text color hex"
                onmousedown={(e: MouseEvent) => e.stopPropagation()}
                onkeydown={(e: KeyboardEvent) => {
                  if (e.key !== "Enter") return;
                  const input = e.target as HTMLInputElement;
                  if (isHexColor(input.value)) {
                    applyCellTextColor(input.value.trim().toLowerCase());
                  }
                }}
              ></input>
            </div>
          </div>

          {/* "Link" layer — expands below the menu */}
          <div
            class={cls(
              "bubble-menu-layer",
              "bubble-menu-layer--link",
              openLayer === "link" && "show",
            )}
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
            {/* Desktop-only element (multi-cell selection bubbles are not
                registered on mobile) — keyboard hints always apply. */}
            <div class="bb-link-foot">
              <kbd>Enter</kbd> apply · <kbd>Esc</kbd> cancel
            </div>
          </div>
        </div>
      );
    }
  } finally {
    props.editor.off("selectionUpdate", refreshState);
    props.editor.off("update", refreshState);
    document.removeEventListener("keydown", onKeydown);
  }
})(elTag("table-cells-bubble-menu-bar"));
