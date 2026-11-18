import { litView } from "@web-companions/lit";
import { p } from "@web-companions/gfc";
import type { App } from "obsidian";
import { ConfirmModal } from "../../ui/ConfirmModal";
import { TextSelection, type Selection, type Transaction } from "prosemirror-state";
import { Editor } from "../../texto/core";
import { elTag } from "../../tags";
import { computeDockMode, type DockMode } from "./dockMode";
import {
  getBubbleMenuState,
  TEXT_COLORS,
  type BubbleMenuState,
} from "../bubble-menu-bar/bubbleMenuState";
import {
  bgHexToAttr,
  getTableMenuState,
  BORDER_COLORS,
  BORDER_STYLES,
  BORDER_WIDTHS,
  pickerHexValue,
  TABLE_BG_RGBA,
  type TableMenuState,
} from "../bubble-menu-bar/tableMenuState";
import {
  getMediaMenuState,
  getSelectedMediaNode,
} from "../bubble-menu-bar/mediaMenuState";
import { bubbleIconNodes } from "../bubble-menu-bar/icons.svgnode";
import { toolbarIconNodes } from "./icon.svgnode";
import { customColorRow } from "../bubble-menu-bar/customColorRow";
import { applyLinkUrl, removeLinkMark } from "./linkActions";
import {
  editMermaidDiagram,
  openMediaFile,
  removeMediaNode,
  replaceMediaFile,
  setImageNodeLayout,
  setMermaidNodeLayout,
} from "../../tools/media";
import {
  copyTableSelection,
  cutTableSelection,
  pasteFromSystemClipboard,
} from "../../texto/extensions/table/helpers/cellClipboard";
import type {
  BorderPen,
  BorderSideName,
} from "../../texto/extensions/table/helpers/borders";
import { isMobileKeyboardOpen } from "../../tools/isMobileKeyboardOpen";
import type { ImageLayout } from "../../texto/extensions/image/image";
import type { ToolbarIconName } from "../icons/iconSprite";

const cls = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");

const COLOR_LABELS: Record<string, string> = {
  violet: "Фиолетовый", green: "Зелёный", yellow: "Жёлтый", red: "Красный",
  orange: "Оранжевый", blue: "Синий", teal: "Бирюзовый", pink: "Розовый",
  gray: "Серый", white: "Белый", black: "Чёрный",
};
const BORDER_STYLE_LABELS: Record<string, string> = {
  solid: "Сплошная", double: "Двойная", dotted: "Точечная", dashed: "Пунктирная",
};

type TextPanel = "format" | "styles" | "link" | "more";
type MainPanel = "blocks" | "lists" | "objects" | "media";
type TablePanel = "actions" | "fill" | "borders";
type MediaPanel = "object" | "layout";
type Panel = TextPanel | MainPanel | TablePanel | MediaPanel;

const HEADING_LEVEL: Record<"h1" | "h2" | "h3", 1 | 2 | 3> = {
  h1: 1,
  h2: 2,
  h3: 3,
};

type MarkAction = "bold" | "italic" | "underline" | "strike" | "code" | "mark";
type BlockAction =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "quote"
  | "list"
  | "taskList";

type IconRenderer = () => ReturnType<typeof bubbleIconNodes.bold>;

const MEDIA_LAYOUTS: Array<{
  align: ImageLayout;
  icon: IconRenderer;
  label: string;
}> = [
  { align: "left", icon: bubbleIconNodes.imgLeft, label: "По левому краю" },
  { align: "center", icon: bubbleIconNodes.imgCenter, label: "По центру" },
  { align: "right", icon: bubbleIconNodes.imgRight, label: "По правому краю" },
  { align: "full", icon: bubbleIconNodes.imgFull, label: "На всю ширину" },
  { align: "wrap-left", icon: bubbleIconNodes.imgWrapLeft, label: "Обтекание слева" },
  { align: "wrap-right", icon: bubbleIconNodes.imgWrapRight, label: "Обтекание справа" },
];

/** The backgroundColor attr value as a picker-able hex (solid hexes pass
 *  through, the design rgba fills map back to their palette key). */
function fillHexForPicker(bg: string | null): string | null {
  if (!bg) return null;
  if (/^#[0-9a-f]{6}$/i.test(bg)) return bg;
  const design = Object.entries(TABLE_BG_RGBA).find(([, rgba]) => rgba === bg);
  return design ? design[0] : null;
}

/**
 * Mobile menu dock (design: «Удобство мобильного редактора», package v2).
 * One bottom dock replaces the docked selection rows and the no-selection
 * toolbar row: a context line, a narrow group row, and one open panel at a
 * time (full-width, docked ABOVE the rows — never a floating popup).
 *
 * Contexts follow computeDockMode: no selection (insert groups applying
 * block styles to the CURRENT block), text selection (format / styles /
 * link / more), table (actions / fill / borders), media (object / layout).
 * Undo/redo live in the app «⋯» menu (owner decision, IMPLEMENTATION.md:20).
 */
export const MenuDockElement = litView.element({
  props: {
    editor: p.req<Editor>(),
    /** Only the media "Open" action needs the app; optional so the browser
     *  harness can mount the dock without a full Obsidian app. */
    app: p.opt<App>(),
  },
})(function* (props) {
  // eslint-disable-next-line @typescript-eslint/no-this-alias -- generator component: needs external this reference for the rAF focus pass
  const root: HTMLElement = this;

  let mode: DockMode = "none";
  let contextDismissed = false;
  let bubbleState: BubbleMenuState = getBubbleMenuState(props.editor);
  let tableState: TableMenuState = getTableMenuState(props.editor.state);
  let openPanel: Panel | null = null;
  let heldSelection: Selection | null = null;
  let heldSelectionInvalid = false;
  let linkDraft = "";
  const colorDrafts = { text: "", fill: "", border: "" };
  let pen: BorderPen = { style: "solid", width: "1pt", color: null };

  const schemaHasComments = props.editor.state.schema.marks.comment != null;
  const canReadClipboard =
    typeof navigator !== "undefined" &&
    !!(navigator.clipboard?.read || navigator.clipboard?.readText);

  /* ── State refresh: the dock is mounted persistently inside the toolbar
     host, so its own editor subscriptions stay alive (no swap pulsing). ── */
  const refreshState = () => {
    if (props.editor.isDestroyed) return;
    contextDismissed = false;
    const next = computeDockMode(props.editor);
    if (!heldSelection && !heldSelectionInvalid) {
      if (next !== mode) openPanel = null;
      mode = next;
    }
    bubbleState = getBubbleMenuState(props.editor);
    tableState = getTableMenuState(props.editor.state);
    void this.next();
  };
  props.editor.on("selectionUpdate", refreshState);
  props.editor.on("update", refreshState);

  // Map the original target through edits outside it. An edit inside the
  // target makes the intended range ambiguous, so require a fresh selection.
  const mapHeldSelection = ({ transaction }: { transaction: Transaction }) => {
    if (!heldSelection || !transaction.docChanged) return;
    let from = heldSelection.from;
    let to = heldSelection.to;
    for (const step of transaction.steps) {
      const map = step.getMap();
      let touched = false;
      map.forEach((start, end) => {
        if (from === to ? start <= from && end >= from : start < to && end > from || start === end && start > from && start < to) touched = true;
      });
      if (touched) {
        heldSelection = null;
        heldSelectionInvalid = true;
        return;
      }
      from = map.map(from, 1);
      to = map.map(to, -1);
    }
    const currentDoc = props.editor.state.doc;
    if (!transaction.doc.eq(currentDoc)) {
      const withoutBlockIds = (doc: typeof currentDoc) => {
        const strip = (node: Record<string, unknown>): Record<string, unknown> => {
          const result = { ...node };
          if (result.attrs && typeof result.attrs === "object") {
            const { id: _id, ...attrs } = result.attrs as Record<string, unknown>;
            result.attrs = attrs;
          }
          if (Array.isArray(result.content)) result.content = result.content.map((child: Record<string, unknown>) => strip(child));
          return result;
        };
        return JSON.stringify(strip(doc.toJSON() as Record<string, unknown>));
      };
      if (withoutBlockIds(transaction.doc) !== withoutBlockIds(currentDoc)) {
        heldSelection = null;
        heldSelectionInvalid = true;
        return;
      }
    }
    if (heldSelection instanceof TextSelection) {
      const backwards = heldSelection.anchor > heldSelection.head;
      heldSelection = TextSelection.create(currentDoc, backwards ? to : from, backwards ? from : to);
    } else {
      heldSelection = heldSelection.map(currentDoc, transaction.mapping);
    }
  };
  props.editor.on("transaction", mapHeldSelection);

  const closePanel = () => {
    if (openPanel) {
      openPanel = null;
      heldSelection = null;
      heldSelectionInvalid = false;
      void this.next();
    }
  };

  // Esc closes the open panel; the key is swallowed only while a panel is
  // open, so the rest of the app never notices this listener.
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && openPanel) {
      e.preventDefault();
      e.stopPropagation();
      closePanel();
    }
  };
  document.addEventListener("keydown", onKeydown);

  let ownedColorPopup: Element | null = null;
  const preserveEditorSelection = (event: PointerEvent) => {
    const colorButton = (event.target as Element).closest(".bb-dd-open");
    if (colorButton) ownedColorPopup = colorButton.parentElement?.querySelector(".bb-dd-popup") ?? null;
    if ((event.target as Element).closest("button")) event.preventDefault();
  };
  root.addEventListener("pointerdown", preserveEditorSelection);
  const prepareHeldSelection = (event: Event) => {
    const target = event.target as Element;
    if (event.type === "click" && !target.closest(".menu-dock__action, .menu-dock__swatch, .menu-dock__link-go, .bb-sw")) return;
    if (event.type === "keydown" && (!(event instanceof KeyboardEvent) || event.key !== "Enter" || !target.matches(".bb-dd-hex, .menu-dock__link-input"))) return;
    if (heldSelectionInvalid) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (heldSelection && !props.editor.state.selection.eq(heldSelection)) {
      props.editor.view.dispatch(props.editor.state.tr.setSelection(heldSelection));
    }
  };
  root.addEventListener("click", prepareHeldSelection, true);
  root.addEventListener("keydown", prepareHeldSelection, true);
  const preparePopupSelection = (event: Event) => {
    const popup = (event.target as Element).closest(".bb-dd-popup.show");
    if (popup && popup === ownedColorPopup && (event.target as Element).closest(".bb-sw")) prepareHeldSelection(event);
  };
  document.addEventListener("click", preparePopupSelection, true);
  const onEditorPointerDown = () => {
    if (openPanel) closePanel();
  };
  props.editor.view.dom.addEventListener("pointerdown", onEditorPointerDown);
  const viewport = window.visualViewport;
  const keyboardIsOpen = () => root.closest(".note-view-container, .notepad-view-container")?.classList.contains("is-keyboard-open") || isMobileKeyboardOpen();
  let observedContainer: Element | null = null;
  const containerObserver = new ResizeObserver((entries) => {
    const entry = entries.find(({ target }) => target === observedContainer);
    if (entry) root.style.setProperty("--dock-container-height", `${entry.contentRect.height}px`);
  });
  const updateViewport = () => {
    if (viewport) root.style.setProperty("--dock-viewport-height", `${viewport.height}px`);
    const container = root.closest(".note-view-container, .notepad-view-container");
    if (container !== observedContainer) {
      containerObserver.disconnect();
      observedContainer = container;
      if (container) containerObserver.observe(container);
      else root.style.removeProperty("--dock-container-height");
    }
    void this.next();
  };
  const keyboardObserver = new MutationObserver((records) => {
    if (records.some(({ target }) => target === document.documentElement || target === document.body || target === root.closest(".note-view-container, .notepad-view-container"))) void this.next();
  });
  keyboardObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
  keyboardObserver.observe(document.body, { attributes: true, subtree: true, attributeFilter: ["style", "class"] });
  viewport?.addEventListener("resize", updateViewport);
  updateViewport();

  const leaveContext = () => {
    const { state, view } = props.editor;
    const { selection, doc } = state;
    let from = selection.from;
    let to = selection.to;
    if (mode === "table") {
      for (let depth = selection.$from.depth; depth > 0; depth--) {
        if (selection.$from.node(depth).type.name === "table") {
          from = selection.$from.before(depth);
          to = selection.$from.after(depth);
          break;
        }
      }
    }
    const target = TextSelection.findFrom(doc.resolve(to), 1, true)
      ?? TextSelection.findFrom(doc.resolve(from), -1, true);
    openPanel = null;
    if (target) view.dispatch(state.tr.setSelection(target));
    else {
      contextDismissed = true;
      mode = "none";
      void this.next();
    }
  };

  const togglePanel = (panel: Panel) => {
    if (openPanel !== panel) {
      const selection = props.editor.state.selection;
      if (!heldSelection && !heldSelectionInvalid && (mode === "text" || (mode === "none" && panel === "link"))) {
        heldSelection = selection;
        heldSelectionInvalid = false;
      }
      props.editor.commands.blur();
      const keyboard = (window as unknown as {
        Capacitor?: { Plugins?: { Keyboard?: { hide?: () => Promise<void> } } };
      }).Capacitor?.Plugins?.Keyboard;
      void keyboard?.hide?.().catch(() => {});
      if (!props.editor.state.selection.eq(selection) && props.editor.state.doc === selection.$from.doc) {
        props.editor.view.dispatch(props.editor.state.tr.setSelection(selection));
      }
    }
    if (panel === "link") {
      const attrs = props.editor.getAttributes("link");
      linkDraft = typeof attrs.href === "string" ? attrs.href : "";
    }
    openPanel = openPanel === panel ? null : panel;
    if (!openPanel) {
      heldSelection = null;
      heldSelectionInvalid = false;
    }
    void this.next().then(() => {
      if (openPanel === "link") {
        window.requestAnimationFrame(() => {
          const input = root.querySelector<HTMLInputElement>(
            ".menu-dock__link-input",
          );
          input?.focus();
          input?.select();
        });
      }
    });
  };

  /* ── Commands (parity: the same chains as the desktop bars / toolbar) ── */
  const applyMark = (mark: MarkAction) => {
    const e = props.editor;
    const map = {
      bold: () => e.chain().focus().toggleBold().run(),
      italic: () => e.chain().focus().toggleItalic().run(),
      underline: () => e.chain().focus().toggleUnderline().run(),
      strike: () => e.chain().focus().toggleStrike().run(),
      code: () => e.chain().focus().toggleCode().run(),
      mark: () => e.chain().focus().toggleHighlight().run(),
    } as const;
    map[mark]();
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

  const applyAlign = (align: "left" | "center" | "right") => {
    props.editor.chain().focus().setTextAlign(align).run();
  };

  const applyColor = (color: string | null) => {
    const e = props.editor;
    if (color == null) {
      e.chain().focus().unsetColor().run();
    } else {
      e.chain().focus().setColor(color).run();
    }
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
      case "dupRow":
        e.chain().focus().duplicateRow().run();
        break;
      case "dupCol":
        e.chain().focus().duplicateColumn().run();
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

  const applyBorderSide = (side: BorderSideName) => {
    props.editor.chain().focus().toggleCellsBorders({ ...pen }, [side]).run();
  };

  /* ── Media actions (same helpers as the desktop media bar) ── */
  const doOpen = () => {
    if (!props.app) return;
    const selected = getSelectedMediaNode(props.editor.state);
    if (selected) openMediaFile(props.app, selected.node);
  };
  const doReplace = () => replaceMediaFile(props.editor);
  const doDelete = () => removeMediaNode(props.editor);
  const doSetLayout = (align: string) => {
    const media = getMediaMenuState(props.editor.state);
    if (media.nodeType === "mermaid") setMermaidNodeLayout(props.editor, align);
    else setImageNodeLayout(props.editor, align as ImageLayout);
  };
  const doEditDiagram = () => editMermaidDiagram(props.editor);

  /* ── Render helpers ── */
  const groupBtn = (opts: {
    id: Panel;
    label: string;
    aria: string;
    icon?: IconRenderer;
    toolbarIcon?: ToolbarIconName;
    text?: string;
  }) => {
    const active = openPanel === opts.id;
    return (
      <button
        class={cls("menu-dock__group", active && "is-open")}
        aria-label={opts.aria}
        aria-expanded={active ? "true" : "false"}
        onclick={() => togglePanel(opts.id)}
      >
        {opts.text ? (
          <span class="menu-dock__group-aa" aria-hidden="true">
            {opts.text}
          </span>
        ) : opts.toolbarIcon ? (
          <span class="menu-dock__icon">
            {toolbarIconNodes[opts.toolbarIcon]({})}
          </span>
        ) : (
          <span class="menu-dock__icon">{opts.icon?.()}</span>
        )}
        <span class="menu-dock__group-label">{opts.label}</span>
      </button>
    );
  };

  const doneBtn = () => (
    <button class="menu-dock__group" aria-label="Готово" onclick={leaveContext}>
      <span class="menu-dock__icon">{bubbleIconNodes.check()}</span>
      <span class="menu-dock__group-label">Готово</span>
    </button>
  );

  const actionBtn = (opts: {
    label: string;
    icon: IconRenderer;
    onclick: () => void;
    danger?: boolean;
    active?: boolean;
    /** Reason string when the command can't apply: the button stays in the
     *  DOM (tab order, screen reader) and explains itself (review F37). */
    disabled?: string;
  }) => {
    const disabled = opts.disabled ?? (opts.danger && !props.app ? "Подтверждение недоступно" : undefined);
    return <button
      class={cls(
        "menu-dock__action",
        opts.danger && "is-danger",
        opts.active && "is-active",
        disabled && "is-disabled",
      )}
      aria-label={disabled ? `${opts.label} — ${disabled}` : opts.label}
      aria-disabled={disabled ? "true" : undefined}
      aria-pressed={opts.active === undefined ? undefined : String(opts.active)}
      data-tip={disabled || undefined}
      onclick={() => {
        if (disabled) return;
        if (!opts.danger) {
          opts.onclick();
          return;
        }
        if (!props.app) return;
        const { doc, selection } = props.editor.state;
        new ConfirmModal(props.app, {
          title: opts.label,
          message: `${opts.label}?`,
          confirmText: "Удалить",
          cancelText: "Отмена",
          onConfirm: () => {
            if (props.editor.isDestroyed) return;
            const current = props.editor.state;
            if (current.doc === doc && current.selection.eq(selection)) opts.onclick();
          },
        }).open();
      }}
    >
      <span class="menu-dock__icon">{opts.icon()}</span>
      <span>{opts.label}</span>
    </button>;
  };

  const colorSwatches = (
    current: string | null,
    onPick: (color: string | null) => void,
    noneLabel: string,
  ) => (
    <div class="menu-dock__swatches">
      {TEXT_COLORS.map((sw) => (
        <button
          class={cls(
            "menu-dock__swatch",
            sw.color == null && "menu-dock__swatch--none",
            (sw.color ?? null) === current && "is-active",
          )}
          aria-pressed={String((sw.color ?? null) === current)}
          style={sw.color ? `background: ${sw.color}` : undefined}
          aria-label={sw.color == null ? noneLabel : (COLOR_LABELS[sw.id] ?? sw.label)}
          title={sw.color == null ? noneLabel : (COLOR_LABELS[sw.id] ?? sw.label)}
          onclick={() => onPick(sw.color)}
        ></button>
      ))}
    </div>
  );

  try {
    while (true) {
      // Re-read states each pass (parity with the media bar): the host may
      // re-render the dock between editor events.
      if (!props.editor.isDestroyed) {
        if (!heldSelection && !heldSelectionInvalid) mode = contextDismissed ? "none" : computeDockMode(props.editor);
        bubbleState = getBubbleMenuState(props.editor);
        tableState = getTableMenuState(props.editor.state);
      }
      const media = getMediaMenuState(props.editor.state);
      const isMermaid = media.nodeType === "mermaid";
      const showLayout =
        mode === "media" &&
        (isMermaid || (media.nodeType === "image" && media.hasFile));
      const keyboardOpen = keyboardIsOpen();
      const dockCols =
        mode === "none" ? 5 : mode === "text" ? 4 : mode === "table" ? 4 : showLayout ? 3 : 2;

      const contextTitle =
        mode === "text"
          ? "Текст выделен"
          : mode === "table"
            ? "Ячейка выделена"
            : mode === "media"
              ? "Объект выбран"
              : "Вставка блоков";
      const contextDetail =
        mode === "text"
          ? "Форматирование"
          : mode === "table"
            ? "Таблица"
            : mode === "media"
              ? isMermaid
                ? "Диаграмма"
                : media.nodeType === "attachment" ? "Вложение" : "Изображение"
              : "Нет выделения";

      props = yield (
        <div class="menu-dock" style={`--dock-cols: ${dockCols}`}>
          {heldSelectionInvalid ? <div role="status">Выделение изменилось. Выберите текст заново.</div> : null}
          {/* ── Panel (docked above the rows; one at a time) ── */}
          {openPanel === "blocks" ? (
            <div class="menu-dock__panel" role="group" aria-label="Текстовые блоки">
              <button class="menu-dock__close" type="button" onclick={closePanel}>Закрыть</button>
              <div class="menu-dock__grid">
                {actionBtn({ label: "Текст", icon: bubbleIconNodes.paragraph, active: bubbleState.paragraph, onclick: () => applyBlock("paragraph") })}
                {actionBtn({ label: "Заголовок 1", icon: bubbleIconNodes.h1, active: bubbleState.h1, onclick: () => applyBlock("h1") })}
                {actionBtn({ label: "Заголовок 2", icon: bubbleIconNodes.h2, active: bubbleState.h2, onclick: () => applyBlock("h2") })}
                {actionBtn({ label: "Заголовок 3", icon: bubbleIconNodes.h3, active: bubbleState.h3, onclick: () => applyBlock("h3") })}
                {actionBtn({ label: "Цитата", icon: bubbleIconNodes.blockquote, active: bubbleState.quote, onclick: () => applyBlock("quote") })}
              </div>
            </div>
          ) : null}
          {openPanel === "lists" ? (
            <div class="menu-dock__panel" role="group" aria-label="Списки">
              <button class="menu-dock__close" type="button" onclick={closePanel}>Закрыть</button>
              <div class="menu-dock__grid">
                {actionBtn({ label: "Список задач", icon: bubbleIconNodes.taskList, active: bubbleState.taskList, onclick: () => applyBlock("taskList") })}
                {actionBtn({ label: "Маркированный список", icon: bubbleIconNodes.list, active: bubbleState.list, onclick: () => applyBlock("list") })}
                {actionBtn({ label: "Нумерованный список", icon: toolbarIconNodes.orderedList, active: props.editor.isActive("orderedList"), onclick: () => props.editor.chain().focus().toggleOrderedList().run() })}
              </div>
            </div>
          ) : null}
          {openPanel === "objects" ? (
            <div class="menu-dock__panel" role="group" aria-label="Вставка блоков">
              <button class="menu-dock__close" type="button" onclick={closePanel}>Закрыть</button>
              <div class="menu-dock__grid">
                {actionBtn({ label: "Таблица", icon: toolbarIconNodes.table, onclick: () => props.editor.chain().focus().insertTable().run() })}
                {actionBtn({ label: "Блок кода", icon: bubbleIconNodes.code, onclick: () => props.editor.chain().focus().toggleHljsCodeBlock().run() })}
                {actionBtn({ label: "Ссылка", icon: bubbleIconNodes.link, onclick: () => togglePanel("link") })}
              </div>
            </div>
          ) : null}
          {openPanel === "media" ? (
            <div class="menu-dock__panel" role="group" aria-label="Вставка медиа">
              <button class="menu-dock__close" type="button" onclick={closePanel}>Закрыть</button>
              <div class="menu-dock__grid">
                {actionBtn({ label: "Изображение", icon: toolbarIconNodes.image, onclick: () => props.editor.chain().focus().selectImageFile().run() })}
                {actionBtn({ label: "Диаграмма", icon: toolbarIconNodes.diagram, onclick: () => props.editor.chain().focus().insertMermaid().run() })}
                {actionBtn({ label: "Вложение", icon: toolbarIconNodes.paperclip, onclick: () => props.editor.chain().focus().setAttachment(true).run() })}
              </div>
            </div>
          ) : null}
          {openPanel === "format" ? (
            <div class="menu-dock__panel" role="group" aria-label="Форматирование текста">
              <button class="menu-dock__close" type="button" onclick={closePanel}>Закрыть</button>
              <div class="menu-dock__grid">
                {actionBtn({ label: "Жирный", icon: bubbleIconNodes.bold, active: bubbleState.bold, onclick: () => applyMark("bold") })}
                {actionBtn({ label: "Курсив", icon: bubbleIconNodes.italic, active: bubbleState.italic, onclick: () => applyMark("italic") })}
                {actionBtn({ label: "Подчёркнутый", icon: bubbleIconNodes.underline, active: bubbleState.underline, onclick: () => applyMark("underline") })}
                {actionBtn({ label: "Зачёркнутый", icon: bubbleIconNodes.strike, active: bubbleState.strike, onclick: () => applyMark("strike") })}
                {actionBtn({ label: "Код в строке", icon: bubbleIconNodes.code, active: bubbleState.code, onclick: () => applyMark("code") })}
                {actionBtn({ label: "Выделение цветом", icon: bubbleIconNodes.mark, active: bubbleState.mark, onclick: () => applyMark("mark") })}
              </div>
            </div>
          ) : null}
          {openPanel === "styles" ? (
            <div class="menu-dock__panel" role="group" aria-label="Стиль и цвет">
              <button class="menu-dock__close" type="button" onclick={closePanel}>Закрыть</button>
              <div class="menu-dock__section-label">Блок</div>
              <div class="menu-dock__grid">
                {actionBtn({ label: "Текст", icon: bubbleIconNodes.paragraph, active: bubbleState.paragraph, onclick: () => applyBlock("paragraph") })}
                {actionBtn({ label: "Заголовок 1", icon: bubbleIconNodes.h1, active: bubbleState.h1, onclick: () => applyBlock("h1") })}
                {actionBtn({ label: "Заголовок 2", icon: bubbleIconNodes.h2, active: bubbleState.h2, onclick: () => applyBlock("h2") })}
                {actionBtn({ label: "Заголовок 3", icon: bubbleIconNodes.h3, active: bubbleState.h3, onclick: () => applyBlock("h3") })}
                {actionBtn({ label: "Цитата", icon: bubbleIconNodes.blockquote, active: bubbleState.quote, onclick: () => applyBlock("quote") })}
              </div>
              <div class="menu-dock__section-label">Выравнивание</div>
              <div class="menu-dock__grid">
                {actionBtn({ label: "Слева", icon: bubbleIconNodes.alignLeft, active: bubbleState.align === "left", onclick: () => applyAlign("left") })}
                {actionBtn({ label: "По центру", icon: bubbleIconNodes.alignCenter, active: bubbleState.align === "center", onclick: () => applyAlign("center") })}
                {actionBtn({ label: "Справа", icon: bubbleIconNodes.alignRight, active: bubbleState.align === "right", onclick: () => applyAlign("right") })}
              </div>
              <div class="menu-dock__section-label">Цвет текста</div>
              {colorSwatches(bubbleState.color, applyColor, "Цвет по умолчанию")}
              {customColorRow({
                value: pickerHexValue(bubbleState.color),
                hexLabel: "HEX цвета текста",
                draft: colorDrafts.text,
                onDraft: (value) => { colorDrafts.text = value; },
                onApply: (hex) => { colorDrafts.text = ""; applyColor(hex); },
              })}
            </div>
          ) : null}
          {openPanel === "more" ? (
            <div class="menu-dock__panel" role="group" aria-label="Другие действия">
              <button class="menu-dock__close" type="button" onclick={closePanel}>Закрыть</button>
              <div class="menu-dock__grid">
                {actionBtn({ label: "Очистить форматирование", icon: bubbleIconNodes.clear, onclick: () => props.editor.chain().focus().unsetAllMarks().run() })}
                {schemaHasComments
                  ? actionBtn({
                      label: "Комментарий",
                      icon: bubbleIconNodes.comment,
                      onclick: () =>
                        root.dispatchEvent(
                          new CustomEvent("inscriptum-request-comment", {
                            bubbles: true,
                          }),
                        ),
                    })
                  : null}
              </div>
            </div>
          ) : null}
          {openPanel === "link" ? (
            <div class="menu-dock__panel" role="group" aria-label="Ссылка">
              <button class="menu-dock__close" type="button" onclick={closePanel}>Закрыть</button>
              <div class="menu-dock__link-row">
                <input
                  class="menu-dock__link-input"
                  type="url"
                  placeholder="https://…"
                  spellcheck={false}
                  aria-label="Адрес ссылки"
                  value={linkDraft}
                  oninput={(e: Event) => {
                    linkDraft = (e.target as HTMLInputElement).value;
                  }}
                  onkeydown={(e: KeyboardEvent) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyLinkUrl(props.editor, linkDraft);
                      closePanel();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      closePanel();
                    }
                  }}
                />
                <button
                  class="menu-dock__link-go"
                  aria-label="Применить ссылку"
                  onclick={() => {
                    applyLinkUrl(props.editor, linkDraft);
                    closePanel();
                  }}
                >
                  {bubbleIconNodes.check()}
                </button>
                <button
                  class="menu-dock__link-go menu-dock__link-go--del"
                  aria-label="Удалить ссылку"
                  onclick={() => {
                    removeLinkMark(props.editor);
                    closePanel();
                  }}
                >
                  {bubbleIconNodes.trash()}
                </button>
              </div>
            </div>
          ) : null}
          {openPanel === "actions" ? (
            <div class="menu-dock__panel" role="group" aria-label="Действия с таблицей">
              <button class="menu-dock__close" type="button" onclick={closePanel}>Закрыть</button>
              <div class="menu-dock__section-label">Строки и столбцы</div>
              <div class="menu-dock__grid">
                {actionBtn({ label: "Строка выше", icon: bubbleIconNodes.rowAbove, onclick: () => applyTableAction("rowAbove") })}
                {actionBtn({ label: "Строка ниже", icon: bubbleIconNodes.rowBelow, onclick: () => applyTableAction("rowBelow") })}
                {actionBtn({ label: "Столбец слева", icon: bubbleIconNodes.colLeft, onclick: () => applyTableAction("colLeft") })}
                {actionBtn({ label: "Столбец справа", icon: bubbleIconNodes.colRight, onclick: () => applyTableAction("colRight") })}
                {actionBtn({ label: "Дублировать строку", icon: bubbleIconNodes.dupRow, onclick: () => applyTableAction("dupRow") })}
                {actionBtn({ label: "Дублировать столбец", icon: bubbleIconNodes.dupCol, onclick: () => applyTableAction("dupCol") })}
              </div>
              <div class="menu-dock__section-label">Ячейки</div>
              <div class="menu-dock__grid">
                {actionBtn({ label: "Копировать ячейки", icon: bubbleIconNodes.copy, onclick: () => copyTableSelection(props.editor.view) })}
                {actionBtn({ label: "Вырезать ячейки", icon: bubbleIconNodes.cut, onclick: () => void cutTableSelection(props.editor.view).catch(() => {}) })}
                {canReadClipboard
                  ? actionBtn({ label: "Вставить ячейки", icon: bubbleIconNodes.paste, onclick: () => void pasteFromSystemClipboard(props.editor.view).catch(() => {}) })
                  : null}
                {actionBtn({
                  label: "Объединить ячейки",
                  icon: bubbleIconNodes.merge,
                  onclick: () => applyTableAction("merge"),
                  disabled: tableState.multiCell && props.editor.can().mergeCells()
                    ? undefined
                    : "Сначала выделите несколько ячеек",
                })}
                {actionBtn({
                  label: "Разделить ячейку",
                  icon: bubbleIconNodes.split,
                  onclick: () => applyTableAction("split"),
                  disabled: tableState.mergedCell
                    ? undefined
                    : "Для объединённой ячейки",
                })}
              </div>
              <div class="menu-dock__section-label">Строки и таблица</div>
              <div class="menu-dock__grid">
                {actionBtn({ label: "Заголовок таблицы", icon: bubbleIconNodes.header, active: tableState.headerRow, onclick: () => applyTableAction("header") })}
                {actionBtn({ label: "Удалить строку", icon: bubbleIconNodes.delRow, danger: true, onclick: () => applyTableAction("delRow") })}
                {actionBtn({ label: "Удалить столбец", icon: bubbleIconNodes.delCol, danger: true, onclick: () => applyTableAction("delCol") })}
                {actionBtn({ label: "Удалить таблицу", icon: bubbleIconNodes.delTable, danger: true, onclick: () => applyTableAction("delTable") })}
              </div>
            </div>
          ) : null}
          {openPanel === "fill" ? (
            <div class="menu-dock__panel" role="group" aria-label="Заливка ячейки">
              <button class="menu-dock__close" type="button" onclick={closePanel}>Закрыть</button>
              {colorSwatches(
                tableState.bg == null
                  ? null
                  : (fillHexForPicker(tableState.bg) ?? tableState.bg),
                applyCellBg,
                "Без заливки",
              )}
              {customColorRow({
                value: pickerHexValue(fillHexForPicker(tableState.bg)),
                hexLabel: "HEX заливки ячейки",
                draft: colorDrafts.fill,
                onDraft: (value) => { colorDrafts.fill = value; },
                onApply: (hex) => { colorDrafts.fill = ""; applyCellBg(hex); },
              })}
            </div>
          ) : null}
          {openPanel === "borders" ? (
            <div class="menu-dock__panel" role="group" aria-label="Границы">
              <button class="menu-dock__close" type="button" onclick={closePanel}>Закрыть</button>
              <div class="menu-dock__pen-row">
                <label class="menu-dock__pen-field">
                  <span>Линия</span>
                  <select
                    class="menu-dock__pen-select"
                    aria-label="Тип линии границы"
                    onchange={(e: Event) => {
                      pen = {
                        ...pen,
                        style: (e.target as HTMLSelectElement)
                          .value as BorderPen["style"],
                      };
                      void this.next();
                    }}
                  >
                    {BORDER_STYLES.map((s) => (
                      <option value={s.id} selected={pen.style === s.id}>
                        {BORDER_STYLE_LABELS[s.id] ?? s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label class="menu-dock__pen-field">
                  <span>Толщина</span>
                  <select
                    class="menu-dock__pen-select"
                    aria-label="Толщина границы"
                    onchange={(e: Event) => {
                      pen = { ...pen, width: (e.target as HTMLSelectElement).value };
                      void this.next();
                    }}
                  >
                    {BORDER_WIDTHS.map((w) => (
                      <option value={w.value} selected={pen.width === w.value}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div class="menu-dock__section-label">Цвет линии</div>
              <div class="menu-dock__swatches">
                {BORDER_COLORS.map((c) => (
                  <button
                    class={cls(
                      "menu-dock__swatch",
                      c.color == null && "menu-dock__swatch--none",
                      pen.color === c.color && "is-active",
                    )}
                    aria-pressed={String(pen.color === c.color)}
                    style={c.color ? `background: ${c.color}` : undefined}
                    aria-label={c.color == null ? "Автоматический цвет" : (COLOR_LABELS[c.id] ?? c.label)}
                    title={c.color == null ? "Автоматический цвет" : (COLOR_LABELS[c.id] ?? c.label)}
                    onclick={() => {
                      pen = { ...pen, color: c.color };
                      void this.next();
                    }}
                  ></button>
                ))}
              </div>
              {customColorRow({
                value: pickerHexValue(pen.color),
                hexLabel: "HEX цвета границы",
                draft: colorDrafts.border,
                onDraft: (value) => { colorDrafts.border = value; },
                onApply: (hex) => {
                  colorDrafts.border = "";
                  pen = { ...pen, color: hex };
                  void this.next();
                },
              })}
              <div class="menu-dock__section-label">Применить границы</div>
              <div class="menu-dock__grid">
                {actionBtn({ label: "Без границ", icon: bubbleIconNodes.bdNone, onclick: () => applyBorderPreset("none") })}
                {actionBtn({ label: "Все границы", icon: bubbleIconNodes.bdAll, onclick: () => applyBorderPreset("all") })}
                {actionBtn({ label: "Внешняя граница", icon: bubbleIconNodes.bdBox, onclick: () => applyBorderPreset("box") })}
                {actionBtn({ label: "Внутренние горизонтальные", icon: bubbleIconNodes.bdInsideH, onclick: () => applyBorderPreset("insideH") })}
                {actionBtn({ label: "Внутренние вертикальные", icon: bubbleIconNodes.bdInsideV, onclick: () => applyBorderPreset("insideV") })}
                {actionBtn({ label: "Верхняя граница", icon: bubbleIconNodes.bdTop, onclick: () => applyBorderSide("top") })}
                {actionBtn({ label: "Правая граница", icon: bubbleIconNodes.bdRight, onclick: () => applyBorderSide("right") })}
                {actionBtn({ label: "Нижняя граница", icon: bubbleIconNodes.bdBottom, onclick: () => applyBorderSide("bottom") })}
                {actionBtn({ label: "Левая граница", icon: bubbleIconNodes.bdLeft, onclick: () => applyBorderSide("left") })}
              </div>
            </div>
          ) : null}
          {openPanel === "object" ? (
            <div class="menu-dock__panel" role="group" aria-label="Действия с объектом">
              <button class="menu-dock__close" type="button" onclick={closePanel}>Закрыть</button>
              <div class="menu-dock__grid">
                {isMermaid
                  ? [
                      actionBtn({ label: "Редактировать диаграмму", icon: bubbleIconNodes.pencil, onclick: doEditDiagram }),
                      actionBtn({ label: "Удалить", icon: bubbleIconNodes.trash, danger: true, onclick: doDelete }),
                    ]
                  : [
                      actionBtn({
                        label: "Открыть",
                        icon: bubbleIconNodes.file,
                        disabled: media.hasFile ? undefined : "Файл ещё не добавлен",
                        onclick: doOpen,
                      }),
                      actionBtn({ label: "Заменить", icon: bubbleIconNodes.replace, onclick: doReplace }),
                      actionBtn({ label: "Удалить", icon: bubbleIconNodes.trash, danger: true, onclick: doDelete }),
                    ]}
              </div>
            </div>
          ) : null}
          {openPanel === "layout" ? (
            <div class="menu-dock__panel" role="group" aria-label="Размещение">
              <button class="menu-dock__close" type="button" onclick={closePanel}>Закрыть</button>
              <div class="menu-dock__grid">
                {MEDIA_LAYOUTS.map((l) =>
                  actionBtn({
                    label: l.label,
                    icon: l.icon,
                    active: media.align === l.align,
                    onclick: () => doSetLayout(l.align),
                  }),
                )}
              </div>
            </div>
          ) : null}

          {/* ── Context line ── */}
          <div class="menu-dock__context">
            <span class="menu-dock__context-title">{contextTitle}</span>
            <span class="menu-dock__context-detail">· {contextDetail}</span>
          </div>

          {/* ── Group row ── */}
          <div class="menu-dock__row">
            {mode === "none" ? (
              <>
                {groupBtn({ id: "blocks", label: "Текст", aria: "Текст и заголовки", text: "Aa" })}
                {groupBtn({ id: "lists", label: "Списки", aria: "Списки", icon: bubbleIconNodes.list })}
                {groupBtn({ id: "objects", label: "Вставка", aria: "Блоки и таблицы", toolbarIcon: "table" })}
                {groupBtn({ id: "media", label: "Медиа", aria: "Медиа и файлы", toolbarIcon: "image" })}
                <button
                  class="menu-dock__group"
                  aria-label={keyboardOpen ? "Скрыть клавиатуру" : "Показать клавиатуру"}
                  onclick={() => {
                    if (keyboardIsOpen()) props.editor.commands.blur();
                    else props.editor.view.focus();
                  }}
                >
                  <span class="menu-dock__icon">
                    {toolbarIconNodes.keyboardHide({})}
                  </span>
                  <span class="menu-dock__group-label">Клавиатура</span>
                </button>
              </>
            ) : mode === "text" ? (
              <>
                {groupBtn({ id: "format", label: "Формат", aria: "Форматирование", icon: bubbleIconNodes.bold })}
                {groupBtn({ id: "styles", label: "Стиль", aria: "Стиль и цвет", text: "Aa" })}
                {groupBtn({ id: "link", label: "Ссылка", aria: "Ссылка", icon: bubbleIconNodes.link })}
                {groupBtn({ id: "more", label: "Ещё", aria: "Другие действия", icon: toolbarIconNodes.dots })}
              </>
            ) : mode === "table" ? (
              <>
                {groupBtn({ id: "actions", label: "Действия", aria: "Действия с таблицей", toolbarIcon: "table" })}
                {groupBtn({ id: "fill", label: "Заливка", aria: "Заливка ячейки", icon: bubbleIconNodes.paintBucket })}
                {groupBtn({ id: "borders", label: "Границы", aria: "Границы", icon: bubbleIconNodes.bdAll })}
                {doneBtn()}
              </>
            ) : (
              <>
                {groupBtn({ id: "object", label: "Объект", aria: "Действия с объектом", icon: bubbleIconNodes.file })}
                {showLayout
                  ? groupBtn({ id: "layout", label: "Размещение", aria: "Размещение", icon: bubbleIconNodes.imgCenter })
                  : null}
                {doneBtn()}
              </>
            )}
          </div>
        </div>
      );
    }
  } finally {
    props.editor.off("selectionUpdate", refreshState);
    props.editor.off("update", refreshState);
    props.editor.off("transaction", mapHeldSelection);
    document.removeEventListener("keydown", onKeydown);
    root.removeEventListener("pointerdown", preserveEditorSelection);
    root.removeEventListener("click", prepareHeldSelection, true);
    root.removeEventListener("keydown", prepareHeldSelection, true);
    document.removeEventListener("click", preparePopupSelection, true);
    props.editor.view.dom.removeEventListener("pointerdown", onEditorPointerDown);
    viewport?.removeEventListener("resize", updateViewport);
    keyboardObserver.disconnect();
    containerObserver.disconnect();
  }
})(elTag("menu-dock"));

/** The factory above is only a value (a custom element constructor); this
 *  alias gives consumers the instance type, with its typed `props`. */
export type MenuDockElement = InstanceType<typeof MenuDockElement>;
