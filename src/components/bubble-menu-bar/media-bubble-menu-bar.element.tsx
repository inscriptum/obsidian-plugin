import type { Instance } from "tippy.js";
import { litView } from "@web-companions/lit";
import { p } from "@web-companions/gfc";
import type { App } from "obsidian";
import { Editor, posToDOMRect } from "../../texto/core";
import { elTag } from "../../tags";
import type { BubbleMenuPluginState } from "../../texto/extensions/bubble-menu/bubble-menu-plugin";
import { getMediaMenuState, getSelectedMediaNode } from "./mediaMenuState";
import { bubbleIconNodes } from "./icons.svgnode";
import type { BubbleIconName } from "../icons/iconSprite";
import {
  openMediaFile,
  removeMediaNode,
  replaceMediaFile,
  setImageNodeLayout,
} from "../../tools/media";
import type { ImageLayout } from "../../texto/extensions/image/image";

const cls = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");

export const MediaBubbleMenuElement = litView.element({
  props: {
    editor: p.req<Editor>(),
    app: p.req<App>(),
  },
})(function* (props) {
  let state = getMediaMenuState(props.editor.state);

  // eslint-disable-next-line @typescript-eslint/no-this-alias -- generator component
  const root: HTMLElement = this;
  const barEl = () => root.querySelector<HTMLElement>(".bubble-menu-bar")!;

  type KeyedPlugin = { key?: { key?: string } };
  const wiredTippies = new WeakSet<Instance>();

  const getTippy = (): Instance | undefined => {
    if (props.editor.isDestroyed) return undefined;
    const es = props.editor.state;
    for (const plugin of es.plugins) {
      const key = (plugin as KeyedPlugin).key?.key;
      if (key === "mediaBubbleMenu") {
        return (plugin.getState(es) as BubbleMenuPluginState | undefined)?.tippy;
      }
    }
    return undefined;
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
  };

  const wireTippy = () => {
    const tippy = getTippy();
    if (tippy && !wiredTippies.has(tippy)) {
      wiredTippies.add(tippy);
      tippy.setProps({ onShow: () => window.requestAnimationFrame(syncCaret) });
    }
  };

  const refreshState = () => {
    if (props.editor.isDestroyed) return;
    state = getMediaMenuState(props.editor.state);
    wireTippy();
    void this.next();
    window.requestAnimationFrame(syncCaret);
  };

  props.editor.on("selectionUpdate", refreshState);
  props.editor.on("update", refreshState);

  const doOpen = () => {
    const sel = getSelectedMediaNode(props.editor.state);
    if (sel) openMediaFile(props.app, sel.node);
  };
  const doReplace = () => replaceMediaFile(props.editor);
  const doDelete = () => removeMediaNode(props.editor, props.app);
  const doSetLayout = (align: ImageLayout) => setImageNodeLayout(props.editor, align);

  // Layout (align/wrap) controls — image nodes with a file only.
  const imageLayouts: Array<{ align: ImageLayout; icon: BubbleIconName; tip: string }> = [
    { align: "left", icon: "imgLeft", tip: "Align left" },
    { align: "center", icon: "imgCenter", tip: "Center" },
    { align: "right", icon: "imgRight", tip: "Align right" },
    { align: "full", icon: "imgFull", tip: "Full width" },
    { align: "wrap-left", icon: "imgWrapLeft", tip: "Wrap text left" },
    { align: "wrap-right", icon: "imgWrapRight", tip: "Wrap text right" },
  ];

  try {
    while (true) {
      // Re-read the state on every render pass: on mobile the menu element is
      // swapped into the bottom toolbar and its own editor-event listeners can
      // go stale (the generator outlives the editor it was connected with);
      // NoteView pulses this.next() on selection updates, so each pass must
      // reflect the CURRENT editor state.
      if (props.editor != null && !props.editor.isDestroyed) {
        state = getMediaMenuState(props.editor.state);
      }
      const name = state.hasFile
        ? state.filename
        : state.nodeType === "image"
          ? "Image"
          : "Attachment";
      const showLayout = state.nodeType === "image" && state.hasFile;

      props = yield (
        <div class="bubble-menu-bar">
          <div class="bubble-menu-media-bar show">
            <button
              class={cls("bb-btn", "bb-media-name", !state.hasFile && "is-disabled")}
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={doOpen}
            >
              {bubbleIconNodes.file()}
              <span class="bb-media-name__text">{name}</span>
            </button>
            <span class="bubble-menu-sep"></span>
            <button
              class="bb-btn"
              data-tip="Replace"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={doReplace}
            >
              {bubbleIconNodes.replace()}
            </button>
            {showLayout && (
              <>
                <span class="bubble-menu-sep"></span>
                {imageLayouts.map((layout) => (
                  <button
                    class={cls("bb-btn", state.align === layout.align && "is-active")}
                    data-tip={layout.tip}
                    onmousedown={(e: MouseEvent) => e.preventDefault()}
                    onclick={() => doSetLayout(layout.align)}
                  >
                    {bubbleIconNodes[layout.icon]()}
                  </button>
                ))}
              </>
            )}
            <button
              class="bb-btn danger"
              data-tip="Delete"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={doDelete}
            >
              {bubbleIconNodes.trash()}
            </button>
          </div>
          <span class="bb-caret"></span>
        </div>
      );
    }
  } finally {
    props.editor.off("selectionUpdate", refreshState);
    props.editor.off("update", refreshState);
  }
})(elTag("media-bubble-menu-bar"));
