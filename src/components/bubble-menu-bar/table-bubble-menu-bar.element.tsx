import type { Instance } from "tippy.js";
import { litView } from "@web-companions/lit";
import { p } from "@web-companions/gfc";
import { Editor, posToDOMRect } from "../../texto/core";
import { elTag } from "../../tags";
import type { BubbleMenuPluginState } from "../../texto/extensions/bubble-menu/bubble-menu-plugin";
import {
  bgHexToAttr,
  getTableMenuState,
  BORDER_COLORS,
  BORDER_STYLES,
  BORDER_WIDTHS,
  isHexColor,
  TABLE_FILLS,
  type TableMenuState,
} from "./tableMenuState";
import type {
  BorderPen,
  BorderSideName,
} from "../../texto/extensions/table/helpers/borders";
import type { BubbleIconName } from "../icons/iconSprite";
import { TEXT_COLORS } from "./bubbleMenuState";
import { bubbleIconNodes } from "./icons.svgnode";

  type OpenLayer = "table-color" | "table-borders" | null;
  type PenSelect = "style" | "width" | "color" | null;

const cls = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");

export const TableBubbleMenuElement = litView.element({
  props: {
    editor: p.req<Editor>(),
  },
})(function* (props) {
  let tableState: TableMenuState = getTableMenuState(props.editor.state);
  let openLayer: OpenLayer = null;
  /** Borders "pen" — persists while the bar is mounted, like in Word. */
  let pen: BorderPen = { style: "solid", width: "1pt", color: null };
  /** Open dropdown inside the borders layer (style/width/color selects). */
  let openSelect: PenSelect = null;
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

  const toggleBordersLayer = () => {
    if (openLayer === "table-borders") {
      closeLayer();
      return;
    }
    openLayer = "table-borders";
    void this.next().then(() => {
      window.requestAnimationFrame(() => {
        placeLayerCaret(
          ".bubble-menu-layer--table-borders",
          '[data-tbl="borders"]',
        );
        placeLayerDirection(".bubble-menu-layer--table-borders");
      });
    });
  };

  /** Table-wide presets apply the pen ("No borders" clears); inside ─/│
     draw the pen on the inner gridlines. The second section — side buttons —
     targets the selected cell(s). */
  const applyBorderPreset = (
    preset: "none" | "all" | "box" | "insideH" | "insideV",
  ) => {
    const e = props.editor;
    switch (preset) {
      case "none":
        e.chain().focus().removeTableBorders().run();
        break;
      case "all":
        e.chain().focus().applyTableBorders({ ...pen }).run();
        break;
      case "box":
        e.chain().focus().setBordersBox({ ...pen }).run();
        break;
      case "insideH":
        e.chain().focus().setBordersInside({ ...pen }, "horizontal").run();
        break;
      case "insideV":
        e.chain().focus().setBordersInside({ ...pen }, "vertical").run();
        break;
    }
  };

  /** Side buttons toggle: the command removes the side when every targeted
     cell already carries the pen (the Word dialog's edge-click behavior). */
  const applyBorderSide = (side: BorderSideName) => {
    props.editor.chain().focus().toggleCellsBorders({ ...pen }, [side]).run();
  };

  const togglePenSelect = (which: PenSelect) => {
    openSelect = openSelect === which ? null : which;
    void this.next().then(() => {
      if (openSelect) window.requestAnimationFrame(closeSelectOnOutsideClick);
    });
  };

  const choosePen = (patch: Partial<BorderPen>) => {
    pen = { ...pen, ...patch };
    openSelect = null;
    void this.next();
  };

  /** Dropdowns close on any click outside the borders layer (the editor
     included); the layer itself stays open while the caret is in the table. */
  const closeSelectOnOutsideClick = () => {
    document.addEventListener(
      "mousedown",
      (e) => {
        if (!openSelect) return;
        const layer = root.querySelector(".bubble-menu-layer--table-borders");
        if (layer && e.target instanceof Node && layer.contains(e.target)) {
          window.requestAnimationFrame(closeSelectOnOutsideClick);
          return;
        }
        openSelect = null;
        void this.next();
      },
      { once: true, capture: true },
    );
  };

  const applyTableAction = (action: string) => {
    const e = props.editor;
    switch (action) {
      case "rowAbove":
        e.chain().focus().addRowBefore().run();
        break;
      case "rowBelow":
        e.chain().focus().addRowAfter().run();
        break;
      case "colLeft":
        e.chain().focus().addColumnBefore().run();
        break;
      case "colRight":
        e.chain().focus().addColumnAfter().run();
        break;
      case "merge":
        e.chain().focus().mergeCells().run();
        break;
      case "split":
        e.chain().focus().splitCell().run();
        break;
      case "delRow":
        e.chain().focus().deleteRow().run();
        break;
      case "delCol":
        e.chain().focus().deleteColumn().run();
        break;
      case "header":
        e.chain().focus().toggleHeaderRow().run();
        break;
      case "delTable":
        e.chain().focus().deleteTable().run();
        break;
    }
  };

  const applyCellBg = (color: string | null) => {
    props.editor
      .chain()
      .focus()
      .setCellsAttribute(
        "backgroundColor",
        bgHexToAttr(color) ?? (null as unknown as string),
      )
      .run();
  };

  const applyCellTextColor = (color: string | null) => {
    props.editor
      .chain()
      .focus()
      .setCellsAttribute("dataColor", color ?? (null as unknown as string))
      .run();
  };

  const syncCaret = () => {
    const editor = props.editor;
    if (editor.isDestroyed || !editor.view) return;
    const { from, to } = editor.view.state.selection;
    const rect = posToDOMRect(editor.view, from, to);
    // The rAF can land while the element is detached or not yet rendered
    // (toolbar re-render / generator restart) — nothing to sync then.
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
      if (key === "tableBubbleMenu") {
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
    tableState = getTableMenuState(props.editor.state);
    // An open pen dropdown follows the selection (re-anchoring is pointless
    // once the selection moves); the LAYER itself stays anchored while the
    // caret is inside the table. Closing the layer on every selection change
    // is wrong here: the save/external change cycle re-dispatches the
    // document and remaps the selection, which used to shut the layer after
    // each border/fill operation — the user had to reopen it for every
    // single step. Moving between cells keeps it open, like Word's
    // non-modal dialog.
    const sel = props.editor.state.selection;
    const selKey = `${sel.from}:${sel.to}`;
    if (selKey !== lastSelKey) {
      openSelect = null;
      lastSelKey = selKey;
    }
    if (!tableState.inTable) {
      openLayer = null;
      openSelect = null;
    }
    wireTippy();
    void this.next();
    window.requestAnimationFrame(syncCaret);
  };

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      // Esc closes the innermost thing first: a pen dropdown, then the layer.
      if (openSelect) {
        e.preventDefault();
        e.stopPropagation();
        openSelect = null;
        void this.next();
        return;
      }
      // Docked into the toolbar there is no tippy — still close the layer.
      if (openLayer) {
        e.preventDefault();
        e.stopPropagation();
        closeLayer();
        return;
      }
      const tippy = getTippy();
      if (!tippy || !tippy.state?.isVisible) return;
      e.preventDefault();
      e.stopPropagation();
      tippy.hide();
    }
  };

  props.editor.on("selectionUpdate", refreshState);
  props.editor.on("update", refreshState);
  document.addEventListener("keydown", onKeydown);

  try {
    while (true) {
      // The pen color select: palette entry, or a custom picker value shown
      // as its hex (rendered before the template so the JSX stays plain).
      const colorEntry = BORDER_COLORS.find(
        (c) => c.color !== null && c.color === pen.color,
      );
      const customColor = pen.color != null && !colorEntry;

      props = yield (
        <div class="bubble-menu-bar">
          <div class="bubble-menu-table-bar show">
            <button
              class="bb-btn"
              data-tip="Row above"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyTableAction("rowAbove")}
            >
              {bubbleIconNodes.rowAbove()}
            </button>
            <button
              class="bb-btn"
              data-tip="Row below"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyTableAction("rowBelow")}
            >
              {bubbleIconNodes.rowBelow()}
            </button>
            <button
              class="bb-btn"
              data-tip="Column left"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyTableAction("colLeft")}
            >
              {bubbleIconNodes.colLeft()}
            </button>
            <button
              class="bb-btn"
              data-tip="Column right"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyTableAction("colRight")}
            >
              {bubbleIconNodes.colRight()}
            </button>
            <span class="bubble-menu-sep"></span>
            <button
              class={cls("bb-btn", !tableState.multiCell && "is-disabled")}
              data-tip="Merge cells"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyTableAction("merge")}
            >
              {bubbleIconNodes.merge()}
            </button>
            <button
              class={cls("bb-btn", !tableState.mergedCell && "is-disabled")}
              data-tip="Split cell"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyTableAction("split")}
            >
              {bubbleIconNodes.split()}
            </button>
            <span class="bubble-menu-sep"></span>
            <button
              class="bb-btn"
              data-tip="Delete row"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyTableAction("delRow")}
            >
              {bubbleIconNodes.delRow()}
            </button>
            <button
              class="bb-btn"
              data-tip="Delete column"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyTableAction("delCol")}
            >
              {bubbleIconNodes.delCol()}
            </button>
            <span class="bubble-menu-sep"></span>
            <button
              class={cls("bb-btn", tableState.headerRow && "is-active")}
              data-tip="Table header"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyTableAction("header")}
            >
              {bubbleIconNodes.header()}
            </button>
            <button
              class={cls("bb-btn", openLayer === "table-color" && "is-active")}
              data-tbl="color"
              data-tip="Fill & color"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={toggleTableColorLayer}
            >
              <span class="bb-aa">Aa</span>
            </button>
            <button
              class={cls(
                "bb-btn",
                openLayer === "table-borders" && "is-active",
              )}
              data-tbl="borders"
              data-tip="Borders"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={toggleBordersLayer}
            >
              {bubbleIconNodes.bdAll()}
            </button>
            <span class="bubble-menu-sep"></span>
            <button
              class="bb-btn danger"
              data-tip="Delete table"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyTableAction("delTable")}
            >
              {bubbleIconNodes.delTable()}
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
            aria-label="Cell fill & text color"
          >
            <span class="bb-layer-caret"></span>
            <div class="bb-layer-label">Cell fill</div>
            <div class="bb-sw-row">
              {TABLE_FILLS.map((sw) => (
                <button
                  class={cls(
                    "bb-sw",
                    `bb-sw--${sw.css}`,
                    (sw.color == null ? null : bgHexToAttr(sw.color)) ===
                      tableState.bg && "is-active",
                  )}
                  aria-label={sw.label}
                  onmousedown={(e: MouseEvent) => e.preventDefault()}
                  onclick={() => applyCellBg(sw.color)}
                ></button>
              ))}
            </div>
            <div class="bb-layer-sep"></div>
            <div class="bb-layer-label">Text color</div>
            <div class="bb-sw-row">
              {TEXT_COLORS.map((sw) => (
                <button
                  class={cls(
                    "bb-sw",
                    `bb-sw--${sw.css}`,
                    (sw.color ?? null) === tableState.textColor && "is-active",
                  )}
                  aria-label={sw.label}
                  onmousedown={(e: MouseEvent) => e.preventDefault()}
                  onclick={() => applyCellTextColor(sw.color)}
                ></button>
              ))}
            </div>
          </div>

          <div
            class={cls(
              "bubble-menu-layer",
              "bubble-menu-layer--table-borders",
              openLayer === "table-borders" && "show",
            )}
            role="dialog"
            aria-label="Borders"
          >
            <span class="bb-layer-caret"></span>
            {/* Row 1 — the pen as self-describing dropdowns: the current
               choice is always visible (style/width/color). */}
            <div class="bb-bd-pen-row">
              <span class="bb-sel-wrap">
                <button
                  class={cls("bb-btn", "bb-sel", openSelect === "style" && "is-open")}
                  aria-label="Line style"
                  onmousedown={(e: MouseEvent) => e.preventDefault()}
                  onclick={() => togglePenSelect("style")}
                >
                  {bubbleIconNodes[BORDER_STYLES.find((s) => s.id === pen.style)!.icon]()}
                  <span class="bb-sel-chev">{bubbleIconNodes.chevronDown()}</span>
                </button>
                {openSelect === "style" ? (
                  <div class="bb-dd" role="listbox" aria-label="Line style">
                    {BORDER_STYLES.map((st) => (
                      <button
                        class={cls("bb-btn", "bb-dd-it", pen.style === st.id && "is-active")}
                        role="option"
                        onmousedown={(e: MouseEvent) => e.preventDefault()}
                        onclick={() => choosePen({ style: st.id })}
                      >
                        {bubbleIconNodes[st.icon]()}
                        <span class="bb-dd-label">{st.label}</span>
                        {pen.style === st.id ? (
                          <span class="bb-dd-tick">{bubbleIconNodes.check()}</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </span>
              <span class="bb-sel-wrap">
                <button
                  class={cls("bb-btn", "bb-sel", openSelect === "width" && "is-open")}
                  aria-label="Stroke weight"
                  onmousedown={(e: MouseEvent) => e.preventDefault()}
                  onclick={() => togglePenSelect("width")}
                >
                  <span
                    class="bb-bd-widthbar"
                    style={`height: ${Math.max(
                      1,
                      Math.round(parseFloat(pen.width) * 2.4),
                    )}px`}
                  ></span>
                  <span class="bb-dd-label">
                    {BORDER_WIDTHS.find((w) => w.value === pen.width)?.label ?? pen.width}
                  </span>
                  <span class="bb-sel-chev">{bubbleIconNodes.chevronDown()}</span>
                </button>
                {openSelect === "width" ? (
                  <div class="bb-dd" role="listbox" aria-label="Stroke weight">
                    {BORDER_WIDTHS.map((w) => (
                      <button
                        class={cls("bb-btn", "bb-dd-it", pen.width === w.value && "is-active")}
                        role="option"
                        onmousedown={(e: MouseEvent) => e.preventDefault()}
                        onclick={() => choosePen({ width: w.value })}
                      >
                        <span
                          class="bb-bd-widthbar"
                          style={`height: ${Math.max(
                            1,
                            Math.round(parseFloat(w.value) * 2.4),
                          )}px`}
                        ></span>
                        <span class="bb-dd-label">{w.label}</span>
                        {pen.width === w.value ? (
                          <span class="bb-dd-tick">{bubbleIconNodes.check()}</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </span>
              <span class="bb-sel-wrap">
                <button
                  class={cls("bb-btn", "bb-sel", openSelect === "color" && "is-open")}
                  aria-label="Border color"
                  onmousedown={(e: MouseEvent) => e.preventDefault()}
                  onclick={() => togglePenSelect("color")}
                >
                  <span
                    class={cls(
                      "bb-sel-dot",
                      colorEntry
                        ? `bb-sw--${colorEntry.css}`
                        : customColor
                          ? null
                          : "bb-sel-dot--auto",
                    )}
                    style={
                      customColor ? `background: ${pen.color}` : undefined
                    }
                  ></span>
                  <span class="bb-dd-label">
                    {colorEntry
                      ? colorEntry.label
                      : customColor
                        ? pen.color!.toUpperCase()
                        : "Auto"}
                  </span>
                  <span class="bb-sel-chev">{bubbleIconNodes.chevronDown()}</span>
                </button>
                {openSelect === "color" ? (
                  <div class="bb-dd" role="dialog" aria-label="Border color">
                    <div class="bb-dd-swatches">
                      {BORDER_COLORS.map((sw) => (
                        <button
                          class={cls(
                            "bb-sw",
                            !sw.color && "bb-sw--auto",
                            (pen.color ?? null) === (sw.color ?? null) &&
                              "is-active",
                          )}
                          style={sw.color ? `background: ${sw.color}` : undefined}
                          aria-label={sw.label}
                          title={sw.label}
                          onmousedown={(e: MouseEvent) => e.preventDefault()}
                          onclick={() => choosePen({ color: sw.color })}
                        ></button>
                      ))}
                    </div>
                    <div class="bb-layer-sep"></div>
                    <div class="bb-dd-custom">
                      <input
                        type="color"
                        value={
                          /^#[0-9a-f]{6}$/i.test(pen.color ?? "")
                            ? (pen.color as string)
                            : "#b3a3f7"
                        }
                        title="Custom color"
                        onmousedown={(e: MouseEvent) => e.stopPropagation()}
                        onchange={(e: Event) =>
                          choosePen({
                            color: (e.target as HTMLInputElement).value,
                          })
                        }
                      ></input>
                      <input
                        type="text"
                        class="bb-dd-hex"
                        placeholder="#rrggbb"
                        maxlength={7}
                        spellcheck={false}
                        onmousedown={(e: MouseEvent) => e.stopPropagation()}
                        onkeydown={(e: KeyboardEvent) => {
                          if (e.key !== "Enter") return;
                          const input = e.target as HTMLInputElement;
                          if (isHexColor(input.value)) {
                            choosePen({ color: input.value.trim().toLowerCase() });
                          }
                        }}
                      ></input>
                    </div>
                  </div>
                ) : null}
              </span>
            </div>
            <div class="bb-layer-sep"></div>
            {/* Row 2 — applying the pen: table-wide presets ┊ the selected
               cells' sides. Presets are actions, not states — no persistent
               active highlight on any of them. */}
            <div class="bb-bd-row">
              <button
                class="bb-btn bb-bd"
                data-tip="No borders"
                onmousedown={(e: MouseEvent) => e.preventDefault()}
                onclick={() => applyBorderPreset("none")}
              >
                {bubbleIconNodes.bdNone()}
              </button>
              <button
                class="bb-btn bb-bd"
                data-tip="All borders"
                onmousedown={(e: MouseEvent) => e.preventDefault()}
                onclick={() => applyBorderPreset("all")}
              >
                {bubbleIconNodes.bdAll()}
              </button>
              <button
                class="bb-btn bb-bd"
                data-tip="Outer border"
                onmousedown={(e: MouseEvent) => e.preventDefault()}
                onclick={() => applyBorderPreset("box")}
              >
                {bubbleIconNodes.bdBox()}
              </button>
              <button
                class="bb-btn bb-bd"
                data-tip="Inside horizontal"
                onmousedown={(e: MouseEvent) => e.preventDefault()}
                onclick={() => applyBorderPreset("insideH")}
              >
                {bubbleIconNodes.bdInsideH()}
              </button>
              <button
                class="bb-btn bb-bd"
                data-tip="Inside vertical"
                onmousedown={(e: MouseEvent) => e.preventDefault()}
                onclick={() => applyBorderPreset("insideV")}
              >
                {bubbleIconNodes.bdInsideV()}
              </button>
              <span class="bubble-menu-sep"></span>
              {(
                [
                  ["top", "Top border", "bdTop"],
                  ["right", "Right border", "bdRight"],
                  ["bottom", "Bottom border", "bdBottom"],
                  ["left", "Left border", "bdLeft"],
                ] as Array<[BorderSideName, string, BubbleIconName]>
              ).map(([side, tip, icon]) => (
                <button
                  class="bb-btn bb-bd"
                  data-tip={tip}
                  onmousedown={(e: MouseEvent) => e.preventDefault()}
                  onclick={() => applyBorderSide(side)}
                >
                  {bubbleIconNodes[icon]()}
                </button>
              ))}
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
})(elTag("table-bubble-menu-bar"));
