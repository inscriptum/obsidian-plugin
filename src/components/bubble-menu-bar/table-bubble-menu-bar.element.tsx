import type { Instance } from "tippy.js";
import { litView } from "@web-companions/lit";
import { p } from "@web-companions/gfc";
import { Editor, posToDOMRect } from "../../texto/core";
import type { BubbleMenuPluginState } from "../../texto/extensions/bubble-menu/bubble-menu-plugin";
import { bgHexToAttr, getTableMenuState, TABLE_FILLS, type TableMenuState } from "./tableMenuState";
import { TEXT_COLORS } from "./bubbleMenuState";
import { bbIcon } from "./icons";

type OpenLayer = "table-color" | null;

const cls = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

export const TableBubbleMenuElement = litView.element({
  props: {
    editor: p.req<Editor>(),
  },
})(function* (props) {
  let tableState: TableMenuState = getTableMenuState(props.editor.state);
  let openLayer: OpenLayer = null;
  let lastSelKey = "";

  const root: HTMLElement = this;
  const barEl = () => root.querySelector<HTMLElement>(".bubble-menu-bar")!;

  const closeLayer = () => {
    if (openLayer) {
      openLayer = null;
      this.next();
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

  const placeLayerDirection = (layerSel: string) => {
    window.requestAnimationFrame(() => {
      const bar = barEl();
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
    this.next().then(() => {
      window.requestAnimationFrame(() => {
        placeLayerCaret(".bubble-menu-layer--table-color", '[data-tbl="color"]');
        placeLayerDirection(".bubble-menu-layer--table-color");
      });
    });
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
    props.editor.chain().focus().setCellsAttribute("backgroundColor", bgHexToAttr(color) ?? (null as unknown as string)).run();
  };

  const applyCellTextColor = (color: string | null) => {
    props.editor.chain().focus().setCellsAttribute("dataColor", color ?? (null as unknown as string)).run();
  };

  const syncCaret = () => {
    const editor = props.editor;
    if (editor.isDestroyed || !editor.view) return;
    const { from, to } = editor.view.state.selection;
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

  /** Plugin instances expose a private `key` field holding the PluginKey name. */
  type KeyedPlugin = { key?: { key?: string } };

  const wiredTippies = new WeakSet<Instance>();

  const getTippy = (): Instance | undefined => {
    if (props.editor.isDestroyed) return undefined;
    const es = props.editor.state;
    for (const plugin of es.plugins) {
      const key = (plugin as KeyedPlugin).key?.key;
      if (key === "tableBubbleMenu") {
        return (plugin.getState(es) as BubbleMenuPluginState | undefined)?.tippy;
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
    const sel = props.editor.state.selection;
    const selKey = `${sel.from}:${sel.to}`;
    if (selKey !== lastSelKey) openLayer = null;
    lastSelKey = selKey;
    wireTippy();
    this.next();
    window.requestAnimationFrame(syncCaret);
  };

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
    }
  };

  props.editor.on("selectionUpdate", refreshState);
  props.editor.on("update", refreshState);
  document.addEventListener("keydown", onKeydown);

  try {
    while (true) {
      props = yield (
        <div class="bubble-menu-bar">
          <div class="bubble-menu-table-bar show">
            <button
              class="bb-btn"
              data-tip="Row above"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyTableAction("rowAbove")}
            >
              {bbIcon.rowAbove()}
            </button>
            <button
              class="bb-btn"
              data-tip="Row below"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyTableAction("rowBelow")}
            >
              {bbIcon.rowBelow()}
            </button>
            <button
              class="bb-btn"
              data-tip="Column left"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyTableAction("colLeft")}
            >
              {bbIcon.colLeft()}
            </button>
            <button
              class="bb-btn"
              data-tip="Column right"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyTableAction("colRight")}
            >
              {bbIcon.colRight()}
            </button>
            <span class="bubble-menu-sep"></span>
            <button
              class={cls("bb-btn", !tableState.multiCell && "is-disabled")}
              data-tip="Merge cells"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyTableAction("merge")}
            >
              {bbIcon.merge()}
            </button>
            <button
              class={cls("bb-btn", !tableState.mergedCell && "is-disabled")}
              data-tip="Split cell"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyTableAction("split")}
            >
              {bbIcon.split()}
            </button>
            <span class="bubble-menu-sep"></span>
            <button
              class="bb-btn"
              data-tip="Delete row"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyTableAction("delRow")}
            >
              {bbIcon.delRow()}
            </button>
            <button
              class="bb-btn"
              data-tip="Delete column"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyTableAction("delCol")}
            >
              {bbIcon.delCol()}
            </button>
            <span class="bubble-menu-sep"></span>
            <button
              class={cls("bb-btn", tableState.headerRow && "is-active")}
              data-tip="Table header"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyTableAction("header")}
            >
              {bbIcon.header()}
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
            <span class="bubble-menu-sep"></span>
            <button
              class="bb-btn danger"
              data-tip="Delete table"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={() => applyTableAction("delTable")}
            >
              {bbIcon.delTable()}
            </button>
          </div>

          <span class="bb-caret"></span>

          <div
            class={cls("bubble-menu-layer", "bubble-menu-layer--table-color", openLayer === "table-color" && "show")}
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
                    (sw.color == null ? null : bgHexToAttr(sw.color)) === tableState.bg && "is-active",
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
                  class={cls("bb-sw", `bb-sw--${sw.css}`, (sw.color ?? null) === tableState.textColor && "is-active")}
                  aria-label={sw.label}
                  onmousedown={(e: MouseEvent) => e.preventDefault()}
                  onclick={() => applyCellTextColor(sw.color)}
                ></button>
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
})("table-bubble-menu-bar");
