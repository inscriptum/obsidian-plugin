import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { WikiFile, WikiHooks } from "./wikilink";

// Obsidian DOM globals (createDiv/createEl), polyfilled by the vitest setup
// and the browser harness — the same runtime contract the table helpers use.

/**
 * The «[[» autocomplete for vault files, the Obsidian way: typing the
 * trigger opens a popup under the caret (file name + path), the query
 * filters as you type, «|» switches to the display-text part, ↑/↓ pick,
 * Enter/Tab/click accept, Esc dismisses. Accepting replaces the whole
 * «[[query|display» chunk with a wikiLink-marked text node — the display
 * text becomes the mark's content, the target lives in the mark attrs.
 *
 * The plugin exists only when wiki hooks are injected (see ExtensionHooks);
 * without them «[[» stays plain text everywhere.
 */

export const wikiSuggestKey = new PluginKey<WikiSuggestState>("wikiSuggest");

/** One past the «[[» … cursor scan: queries stay short, but a long line
 *  must not be rescanned entirely on every keystroke. */
const MAX_SCAN = 240;

/** Popup list length cap. */
export const MAX_SUGGESTIONS = 12;

export interface WikiQuery {
  /** Offset of «[[» in the scanned text. */
  from: number;
  query: string;
  /** Text after «|», or null while no pipe has been typed. */
  display: string | null;
}

/**
 * Parses the text before the caret for an open «[[…» trigger. Null when no
 * unclosed trigger ends at the caret (closed «[[…]]» pairs, «[» singles and
 * newlines all stop the match).
 */
export function extractWikiQuery(textBefore: string): WikiQuery | null {
  const window = textBefore.slice(-MAX_SCAN);
  // Neither part may contain brackets/pipe: «]]» closes the link, «|»
  // switches to the display text, «[» starts a nested trigger.
  // The display class excludes brackets too: a COMPLETE link followed by
  // text must not re-trigger the suggest (owner round-5: the popup
  // swallowed everything typed after a closed link).
  const match = /\[\[([^[|\]]*)(\|([^\][]*))?$/.exec(window);
  if (match == null) return null;
  return {
    from: textBefore.length - window.length + match.index,
    query: match[1] ?? "",
    display: match[3] ?? null,
  };
}

/**
 * Fuzzy score of a file against the query (0 = no match). Case-insensitive;
 * basename hits outrank path hits, contiguous hits outrank sparse
 * subsequence matches, shorter names win ties — a pragmatic stand-in for
 * Obsidian's ranking that needs no index.
 */
export function scoreFile(file: WikiFile, query: string): number {
  if (query.length === 0) return 1;
  const q = query.toLowerCase();
  const name = file.name.toLowerCase();
  const path = file.path.toLowerCase();

  if (name.startsWith(q)) return 100 + q.length / name.length;
  const nameIdx = name.indexOf(q);
  if (nameIdx >= 0) return 80 - nameIdx * 0.1;
  if (path.includes(q)) return 60;

  // Subsequence over the basename (contiguous runs score higher).
  let score = 0;
  let cursor = -1;
  for (const ch of q) {
    const idx = name.indexOf(ch, cursor + 1);
    if (idx < 0) return 0;
    score += idx === cursor + 1 ? 2 : 1;
    cursor = idx;
  }
  return 40 + score / (name.length * 8);
}

/** Query-filtered, best-first file list for the popup. */
export function filterFiles(
  files: WikiFile[],
  query: string,
  limit = MAX_SUGGESTIONS,
): WikiFile[] {
  if (query.length === 0) {
    return files.slice(0, limit);
  }
  return files
    .map((file) => ({ file, score: scoreFile(file, query) }))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.file.path.localeCompare(b.file.path),
    )
    .slice(0, limit)
    .map((entry) => entry.file);
}

interface WikiSuggestState {
  active: boolean;
  /** Doc position of the «[[». */
  from: number;
  query: string;
  display: string | null;
  /** Doc position AFTER the closing «]]» when one sits after the caret
   *  (re-entered or auto-closed link) — accept replaces through it. */
  closeEnd: number | null;
  /** Esc-pressed for this query; resets when the query/display changes. */
  dismissed: boolean;
  selected: number;
}

const initial: WikiSuggestState = {
  active: false,
  from: 0,
  query: "",
  display: null,
  closeEnd: null,
  dismissed: false,
  selected: 0,
};

/** Recomputes the suggest state from the caret of `tr`'s resulting doc. */
function scan(state: WikiSuggestState, tr: Transaction): WikiSuggestState {
  const { $from } = tr.selection;
  if (!tr.selection.empty) return initial;
  const parent = $from.parent;
  if (!parent.isTextblock) return initial;
  // The trigger lives in plain text: never inside code — the row itself or
  // the marks-free paragraph variant of a code block, or an inline code span.
  let inCode = false;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name;
    if (name === "hljsCodeBlock" || name === "hljsCodeBlockRow") {
      inCode = true;
      break;
    }
  }
  if (inCode) return initial;
  if ($from.marks().some((m) => m.type.name === "code")) return initial;

  const textBefore = parent.textBetween(0, $from.parentOffset, undefined, "\ufffc");
  const query = extractWikiQuery(textBefore);
  if (query == null) return initial;

  // A closing «]]» after the caret (auto-closed pair or a re-entered
  // complete link) — accept replaces through it instead of leaving it.
  const textAfter = parent.textBetween(
    $from.parentOffset,
    parent.content.size,
    undefined,
    "\ufffc",
  );
  const closeIdx = textAfter.indexOf("]]");
  const closeEnd = closeIdx >= 0 ? $from.pos + closeIdx + 2 : null;

  const from = $from.start() + query.from;
  const changedTarget =
    query.query !== state.query || query.display !== state.display;
  return {
    active: true,
    from,
    query: query.query,
    display: query.display,
    closeEnd,
    dismissed: changedTarget ? false : state.dismissed,
    selected: changedTarget ? 0 : Math.min(state.selected, MAX_SUGGESTIONS - 1),
  };
}

function apply(
  state: WikiSuggestState,
  tr: Transaction,
): WikiSuggestState {
  const meta = tr.getMeta(wikiSuggestKey) as
    | { selected?: number; dismissed?: boolean; close?: boolean }
    | undefined;
  if (meta?.close) return initial;

  const next = scan(state, tr);
  if (!next.active) return next;
  if (meta?.dismissed) return { ...next, dismissed: true };
  if (meta?.selected != null) return { ...next, selected: meta.selected };
  return next;
}

/**
 * Accepts the highlighted (or given) file: the «[[…» chunk at the caret is
 * replaced by the complete inline syntax `[[path]]` (or `[[path|display]]`
 * when a display text was typed), the caret lands right after the closing
 * brackets. Dispatch-free so tests and the popup reuse it with any sink.
 */
export function acceptWikiSuggestion(
  state: import("prosemirror-state").EditorState,
  dispatch: (tr: Transaction) => void,
  file: WikiFile,
  suggest: { from: number; display: string | null; closeEnd?: number | null },
  cursorPos: number,
): boolean {
  const display =
    suggest.display != null && suggest.display.length > 0
      ? `|${suggest.display}`
      : "";
  const text = `[[${file.path}${display}]]`;
  // Replace through the closing «]]» when one sits after the caret (the
  // auto-closed pair or a re-entered complete link) — otherwise the old
  // brackets would survive as garbage after the accepted link.
  const to =
    suggest.closeEnd != null && suggest.closeEnd >= cursorPos
      ? suggest.closeEnd
      : cursorPos;
  const tr = state.tr.replaceWith(
    suggest.from,
    to,
    state.schema.text(text),
  );
  const end = suggest.from + text.length;
  tr.setSelection(TextSelection.create(tr.doc, Math.min(end, tr.doc.content.size)));
  tr.setMeta(wikiSuggestKey, { close: true });
  dispatch(tr);
  return true;
}

export function wikiSuggestPlugin(hooks: WikiHooks): Plugin<WikiSuggestState> {
  let popup: HTMLElement | null = null;
  /** Absorbs the second bracket of a typed «]]» right after a skip-over. */
  let skipLatchUntil = 0;
  // The view is captured by the plugin view below; filterTransaction (which
  // has no view argument) needs it to dispatch the delayed accept.
  let viewRef: EditorView | null = null;

  const destroyPopup = () => {
    popup?.remove();
    popup = null;
  };

  return new Plugin<WikiSuggestState>({
    key: wikiSuggestKey,
    state: {
      init: () => initial,
      apply: (tr, value) => apply(value, tr),
    },
    props: {
      handleKeyDown(view, event) {
        // The tail of a swallowed «]]»: right after a skip the second
        // bracket of the typed pair is absorbed too (within the latch).
        if (event.key === "]" && Date.now() < skipLatchUntil) {
          event.preventDefault();
          return true;
        }
        const state = wikiSuggestKey.getState(view.state);
        if (state?.active !== true || state.dismissed) return false;
        // Space in the LABEL part (after «|») closes the link: the space is
        // inserted after the closing brackets and the caret lands after it —
        // the owner model (text continues outside the link). Targets with
        // spaces stay typable: in the target part the space goes through.
        if (
          event.key === " " &&
          state.display != null &&
          state.closeEnd != null
        ) {
          event.preventDefault();
          // One transaction: view.state.tr creates a NEW transaction on every
          // access — chaining two accesses orphans the first one's steps.
          const tr = view.state.tr;
          tr.insertText(" ", state.closeEnd, state.closeEnd);
          tr.setSelection(TextSelection.create(tr.doc, state.closeEnd + 1));
          tr.setMeta(wikiSuggestKey, { close: true });
          tr.setMeta("pointer", true);
          view.dispatch(tr);
          view.focus();
          return true;
        }
        // Typing «]» when the closing «]]» already sits after the caret (the
        // auto-closed pair) skips over it instead of doubling the brackets
        // (the Obsidian behavior) and closes the suggest. The latch absorbs
        // the second bracket of the typed pair.
        if (event.key === "]" && state.closeEnd != null) {
          event.preventDefault();
          skipLatchUntil = Date.now() + 500;
          view.dispatch(
            view.state.tr
              .setSelection(TextSelection.create(view.state.doc, state.closeEnd))
              .setMeta(wikiSuggestKey, { close: true }),
          );
          view.focus();
          return true;
        }
        const candidates = filterFiles(hooks.listFiles(), state.query);
        if (candidates.length === 0) return false;

        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          const selected =
            (state.selected + step + candidates.length) % candidates.length;
          view.dispatch(view.state.tr.setMeta(wikiSuggestKey, { selected }));
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          const file = candidates[Math.min(state.selected, candidates.length - 1)];
          acceptWikiSuggestion(
            view.state,
            (tr) => view.dispatch(tr),
            file,
            state,
            view.state.selection.from,
          );
          view.focus();
          return true;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          view.dispatch(view.state.tr.setMeta(wikiSuggestKey, { dismissed: true }));
          return true;
        }
        return false;
      },
    },
    // Android only: prosemirror-view skips handleKeyDown for Enter
    // (android && chrome, keyCode 13), so the accept above never runs and
    // the Enter lands as a newline that breaks the trigger. While the
    // suggest is active with candidates, the only Enter-produced
    // transaction is the keypress — block the split and accept instead.
    // (On desktop handleKeyDown intercepts Enter before any dispatch, so
    // this branch is unreachable there.)
    filterTransaction(tr, state) {
      const suggest = wikiSuggestKey.getState(state);
      if (suggest?.active !== true || suggest.dismissed) return true;
      const candidates = filterFiles(hooks.listFiles(), suggest.query);
      if (candidates.length === 0) return true;
      if (!looksLikeEnter(tr)) return true;
      const view = viewRef;
      if (view == null || view.isDestroyed) return true;
      const file = candidates[Math.min(suggest.selected, candidates.length - 1)];
      window.setTimeout(() => {
        if (view.isDestroyed) return;
        acceptWikiSuggestion(
          view.state,
          (ntr) => view.dispatch(ntr),
          file,
          suggest,
          view.state.selection.from,
        );
        view.focus();
      }, 0);
      return false;
    },
    view(editorView) {
      viewRef = editorView;
      // Hide the popup when a mousedown lands outside the editor AND the
      // popup (sidebar, toolbar, another editor): the transaction-driven
      // update never fires for those, and a focus change alone does not
      // always arrive — this is what left popups stuck on screen (owner
      // round-5, «зависшая модалка»). Popup items stopPropagation on their
      // mousedown, so accepting never triggers this path.
      const onDocMouseDown = (event: MouseEvent) => {
        if (popup == null) return;
        const target = event.target as Node | null;
        if (editorView.dom.contains(target) || popup.contains(target)) return;
        destroyPopup();
      };
      const onFocusOut = () => {
        window.setTimeout(() => {
          const active = document.activeElement;
          if (!editorView.dom.contains(active)) {
            destroyPopup();
          }
        }, 0);
      };
      // Reposition on any scroll (capture: the note scroller is an ancestor
      // of the editor, and scroll does not bubble) and on window resize.
      const reposition = () => {
        const st = wikiSuggestKey.getState(editorView.state);
        if (st?.active === true && !st.dismissed && popup != null) {
          positionPopup(editorView, popup, st.from);
        }
      };
      const onScroll = () => reposition();
      const onResize = () => reposition();
      editorView.dom.addEventListener("focusout", onFocusOut);
      document.addEventListener("mousedown", onDocMouseDown, true);
      document.addEventListener("scroll", onScroll, true);
      window.addEventListener("resize", onResize);
      return {
        update(view, _prevState) {
          const next = wikiSuggestKey.getState(view.state);
          if (next?.active !== true || next.dismissed) {
            if (popup != null) destroyPopup();
            return;
          }
          const candidates = filterFiles(hooks.listFiles(), next.query);
          if (candidates.length === 0) {
            if (popup != null) destroyPopup();
            return;
          }
          if (popup == null) {
            popup = createDiv("texto-wiki-suggest");
            document.body.appendChild(popup);
          }
          renderPopup(view, popup, next, candidates);
          positionPopup(view, popup, next.from);
        },
        destroy() {
          editorView.dom.removeEventListener("focusout", onFocusOut);
          document.removeEventListener("mousedown", onDocMouseDown, true);
          document.removeEventListener("scroll", onScroll, true);
          window.removeEventListener("resize", onResize);
          destroyPopup();
        },
      };
    },
  });

  /** Whether the transaction looks like the Enter keypress. splitBlock
   *  serializes as a replace/replaceAround whose slice carries empty
   *  paragraphs (a direct SplitStep shows up as stepType "split"), and
   *  Shift-Enter inserts a hardBreak; the IME newline path may arrive as a
   *  plain "\n" text insert. Real typing (IME commits, paste of text) does
   *  not match; pasting empty paragraphs while the suggest is open is the
   *  only false positive — vanishingly rare, and undoable. */
  function looksLikeEnter(tr: Transaction): boolean {
    if (!tr.docChanged) return false;
    for (const step of tr.steps) {
      const json = step.toJSON() as {
        stepType?: string;
        slice?: { content?: { type?: string; content?: unknown; text?: string }[] };
      };
      if (json.stepType === "split") return true;
      const sliceContent = json.slice?.content;
      if (!sliceContent?.length) continue;
      if (sliceContent.some((n) => n.type === "hardBreak")) return true;
      if (
        sliceContent.every(
          (n) =>
            (n.type === "paragraph" && n.content == null) ||
            (n.type === "text" && n.text === "\n"),
        )
      ) {
        return true;
      }
    }
    return false;
  }

  function renderPopup(
    view: EditorView,
    el: HTMLElement,
    state: WikiSuggestState,
    candidates: WikiFile[],
  ): void {
    el.replaceChildren();
    const list = createDiv("texto-wiki-suggest__list");
    const selected = Math.min(state.selected, candidates.length - 1);
    candidates.forEach((file, index) => {
      // A div, deliberately not a button: Obsidian's base button styles
      // would bleed into items through higher-specificity selectors (the
      // raised-card artifact of the first review round).
      const item = createDiv("texto-wiki-suggest__item");
      item.setAttribute("role", "option");
      if (index === selected) {
        item.className += " is-selected";
      }
      const name = createDiv("texto-wiki-suggest__name");
      name.textContent = file.name;
      const path = createDiv("texto-wiki-suggest__path");
      path.textContent = file.path;
      item.appendChild(name);
      item.appendChild(path);
      // mousedown, not click: keeps the editor focus (a click would blur
      // the editor and close the keyboard on mobile).
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        acceptWikiSuggestion(
          view.state,
          (tr) => view.dispatch(tr),
          file,
          state,
          view.state.selection.from,
        );
        view.focus();
      });
      list.appendChild(item);
    });
    el.appendChild(list);
    // The Obsidian-style hint bar — v1 supports only the display text.
    const footer = createDiv("texto-wiki-suggest__footer");
    footer.textContent = "Type | to change display text";
    el.appendChild(footer);
  }

  function positionPopup(
    view: EditorView,
    el: HTMLElement,
    from: number,
  ): void {
    let coords: { left: number; top: number; bottom: number } | null = null;
    try {
      coords = view.coordsAtPos(from);
    } catch {
      destroyPopup();
      return;
    }
    const margin = 8;
    const height = el.offsetHeight || 200;
    const width = el.offsetWidth || 280;
    let top = coords.bottom + 4;
    if (top + height > window.innerHeight - margin) {
      // Above the caret when it would leave the viewport (soft keyboard).
      top = Math.max(margin, coords.top - height - 4);
    }
    // Clamp both axes: a stale/garbage coords result must never park the
    // popup half off-screen or over the app chrome.
    top = Math.min(
      Math.max(margin, top),
      Math.max(margin, window.innerHeight - height - margin),
    );
    const left = Math.min(
      Math.max(margin, coords.left),
      Math.max(margin, window.innerWidth - width - margin),
    );
    el.setAttribute(
      "style",
      `left:${left.toFixed(0)}px; top:${top.toFixed(0)}px;`,
    );
  }
}
