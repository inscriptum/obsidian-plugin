# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Tables: a Borders control, MS Word style. The table toolbar gains a Borders button opening a layer with a pen row — line style (solid / double / dotted / dashed), stroke weight (¼–6 pt, Word's steps) and color (11-color palette plus a custom color: native color picker and a `#rgb`/`#rrggbb` hex field; the chosen value is always visible on the select) — and an apply row split by a separator: whole-table presets (No borders, All borders, Outer border, Inside horizontal, Inside vertical — each applies the current pen) and the selected cell's sides (toggle, like clicking an edge in Word's dialog). Borders are stored per cell side in the note (they survive reopen and sync), ride along on paste and website export, and adjacent-cell collisions resolve like in Word (`border-collapse`). "No borders" suppresses the default grid for the whole table — including cells added later — while explicitly drawn borders still render on top of it.
- Tables on desktop now follow the mobile model: the table controls dock into the note toolbar whenever the focus is inside a table (caret in a cell or a cell selection), replacing the typography buttons — the save/word-count meta stays visible. The floating table bubble menu while typing in a cell is gone. Selecting several cells opens a floating bubble with the full text-formatting row — bold, italic, underline, strikethrough, inline code, highlight, fill & cell text color, link (URL layer, ⌘K), clear formatting — applied to every selected cell.
- Notepad: folded page rows show when the page was last updated — "date · word count" under the title, in the app's locale format, with the exact timestamp (down to seconds) on hover. Pages carry their last-update stamp inside the .um manifest as an additive field; pages not edited since the feature's introduction show the notepad file's last-save time instead.
- New document type: notepad (`.um`) — a single file that holds an ordered list of pages, edited one under another like one document. Pages can be added, duplicated, deleted (with confirmation and undo), renamed inline and reordered by drag & drop; each page can be collapsed, and its expanded/collapsed state is remembered.
- The first page is the notepad's title page — a fixed cover (title + summary) that can't be deleted, moved or renamed. Other pages don't need a title: their display title comes from the first line.
- Notepad navigation drawer (☰): lists all pages and jumps to the clicked one (smooth scrolling).
- Notebook-wide search (`Cmd/Ctrl+F`): finds across all pages, including collapsed ones, and jumps to the match.
- Images added inside a notepad are packed into the `.um` file itself, so the notepad is self-contained; other attachments stay as regular vault files.
- Pages created in a newer version of the plugin open with a "created in a newer version" notice instead of an editor and are preserved untouched on save.
- "New notepad" command and a Type selector (Note/Notepad) in the "New inscriptum" modal.
- Esc cancels a notepad page drag: the drop line and the page highlight disappear, and releasing the mouse afterwards performs nothing — no reorder and no fold toggle from the release click.

### Fixed

- Tables: a multi-cell selection could crash with "Cannot read properties of null (reading 'getBoundingClientRect')" — a pending caret-sync callback of a bubble menu fired while the menu element was being moved between containers (its first tippy mount) and had not rendered yet. All bubble menus now tolerate that empty state, and the layer caret placers are guarded the same way.
- Notepad: expanding a page no longer makes its content jump down a few pixels after the unfold. While the fold morph held the page frame at the row height with `overflow: hidden`, that frame was still a scroll container — the editor's initial autofocus scrolled it internally (~18px), so the page revealed pre-scrolled with its top padding clipped away, and releasing the pin reset the scroll, snapping the content down. The morph now pins the frame with `overflow: clip` (nothing can scroll it) and skips the editor autofocus while morphing; the real focus is applied after the morph settles, as before.
- Links whose text carries any formatting (underline, bold, italic, strike, code, highlight, color) ignored clicks: the click handler only accepted clicks landing on the `<a>` element itself, while marks render as nested elements inside it. The anchor is now resolved up the DOM tree, so a click anywhere on the link text opens it.

- Notepad: the page drag & drop drop line marked the wrong spot in scrolled documents — it sat below the real insertion point by the whole scrolled amount, because it was positioned from a scroll-immune layout offset. The line now tracks the scroll position, and the dropped page lands exactly on the boundary the line marks: the insertion index also skipped the title page slot, which put the page one boundary higher than the line showed.

- Saving a `.um` container can no longer clobber its own manifest or note documents: asset descriptors naming a protected archive path (e.g. a hand-edited registry) are skipped at write time instead of overwriting the required entries.
- Assets are no longer garbage-collected while a notepad has a page this editor cannot interpret (newer version, unknown family, failed migration): the page is preserved verbatim, so its media stays in the archive even if its references use a shape this editor does not know.
- Opening a `.um` file is size-guarded against zip bombs: archives over a compressed-size cap are rejected before being read into memory, and decompression is bounded by a cap on the total inflated size — a hostile `.um` fails cleanly with a "too large" error instead of exhausting memory.
- Notepad saves no longer lose edits made while a save is in flight.
- Image layouts in notepads are scoped to their page: "full width" no longer spans the whole window, and wrap-layout images no longer float into the following pages.
- Toggling the plugin off/on without an app restart no longer breaks images/attachments.

## [0.9.0] - 2026-09-18

### Added

- "Export as website" command and note pane-menu item: a note becomes a self-contained static page (`index.html`, `note.css` with embedded fonts, `images/`) inside the vault, ready to host anywhere.
- Hide-keyboard button at the right end of the mobile toolbar.

### Fixed

- Every note now ends with an empty paragraph: when the last block is anything else (code block, image, table, heading, list, …) the editor keeps a paragraph below it, so the caret can always be placed at the end of the note. Previously a trailing code block or image left nowhere to put the caret (a stub cursor on desktop; on mobile the note could not be continued at all), and a click near a trailing image selected it, so the next keystroke replaced it.
- iOS: a dead strip between the toolbar and the keyboard — the safe-area inset kept padding the toolbar while the inset area was hidden behind the keyboard (`is-keyboard-open` now zeroes it).
- iOS: toolbar/selection-bar horizontal flings past their edge opened the file/info drawers and dismissed the keyboard (scroll chaining is contained; the toolbar host carries `data-ignore-swipe`, Obsidian's own opt-out from its drawer-swipe gesture).
- iOS: taps on the note periodically did nothing after drawer interactions — WKWebView stopped synthesizing mouse events, so ProseMirror never saw the tap; focus now also recovers on `pointerup` (always delivered), only for real taps, and the editor stays unfocused while a drawer is open (matching native Obsidian — no keyboard floating above it).
- Desktop: switching back to a note pane no longer resets the caret/selection when the file on disk is unchanged; external changes with unsaved local edits now route to the conflict dialog instead of silently reloading.

---

## [0.8.0] - 2026-09-17

### Added

- New code block controls.
- Link button in the note toolbar.

### Fixed

- Notes containing schema-invalid empty text nodes could not be opened at all.
- Mobile: the "Styles & color" menu was broken.

---

## [0.7.2] - 2026-09-16

### Changed

- Update toolbar buttons

### Fixed

- Drag handle beside floated images, both sides of it.
- Mobile: any edit kicked the user out of the note. The 0.7.0 atomic-write fallback replaced a save with remove+rename of the note file; the remove fired a vault "delete" for the OPEN note and Obsidian closed the view. The mobile fallback now overwrites the file in place — the note stays open — while the temp file written beforehand still guards against data loss on a crash mid-write.

---

## [0.7.1] - 2026-09-15

### Changed

- Block drag handle: hover resolution redesigned around line ownership — the hovered unit is the deepest block/list item whose line contains the pointer, so the drag handle appears no matter how far left of the content the pointer is (the whole gutter belongs to the block on that line). A whole-list handle is now always visible while the pointer is anywhere inside a list: it sits on the first item's line, one slot left of the first item's own handle, and drags the entire list with all its items (nested levels included — each list level gets its own handle).

### Fixed

- Prevent floating styles with some blocks.
- Fold chevron ↔ drag interplay (headings, foldable tasks): hovering no longer swaps the chevron for the dots handle — the chevron is force-revealed in the gutter instead; a quick click folds/unfolds as before, pressing and holding swaps the dots handle in, and moving from there drags the unit. Pointer jitter while holding no longer cancels the grab, and a held release without movement still toggles the fold (exactly once — no pointer capture on chevron presses). The chevron is now fully hidden while the dots handle is in its place — even with the pointer hovering it, where Chrome latches :hover to the pressed chevron — and the dots are centered on the chevron's glyph instead of its box edge.
- A list with a single item shows only that item's drag handle — no second whole-list handle for the same move (a single-item list IS its item).
- Block drag handle stayed visible and glued to a stale position after the document changed (typing, adding blocks): the handle is now hidden on any document change while the pointer is idle — it reappears when the mouse moves again and resolves the block under it. An active drag is unaffected.

---

## [0.7.0] - 2026-09-15

### Added

- Optional diagnostic log, off by default: enable it in the plugin settings ("Diagnostic log") or with `localStorage.setItem("inscriptum-write-log", "1")` in the Obsidian console — the plugin then appends one JSON line per event to the hidden file `.inscriptum-log.jsonl` at the vault root (entries carry a `kind` field; note writes are logged first: time, trigger, path, sizes, result, duration).
- Block drag & drop on desktop
- Image positioning and text wrap: a selected image's bubble menu now has layout controls.
- Image resizing: a selected image shows drag handles on its left and right edges. Dragging changes the width live and saves it as a percent of the content width (5–100%, min 80px), so proportions hold on mobile. Undoable as a single step. Handles are hidden for error placeholders, empty image nodes and full-width images.
- Click-to-zoom for images: clicking a selected image opens a fullscreen lightbox with the image at the largest size that fits the screen (file name shown below). Close with a click anywhere or `Esc`. Does nothing for images whose file is missing.

### Fixed

- Note files could be wiped to 0 bytes when a save raced with a plugin reload or app restart: writes used Obsidian's truncate-then-write, so a renderer that died mid-write left an empty file behind.
- Select all with fold sections
- Adding a new line inside folded sections
- Broken images after their attachment files were deleted behind the editor's back. Three fixes:
  - Attachment files are no longer deleted from the vault when an image node leaves the document implicitly (undo/redo, cut, external overwrite). The file is now removed only by the image's explicit delete button, and only when no other image node still references the same file. Previously, deleting an image block and pressing `Cmd/Ctrl+Z` restored the node but left it pointing at a trashed file.
  - A persisted image error state no longer sticks forever: when the attachment file is available again (renamed back, restored from trash/backup), the image is reloaded on the next render. When the file is missing, the error block now explains what happened (`File not found: <file name>`) instead of showing a silent gray box. Image load failures report the file name too.
  - Empty leftover image nodes (from an interrupted paste/upload in a previous session) are removed when the editor opens, instead of staying as unremovable "select a file" placeholders forever.

---

## [0.6.1] - 2026-09-08

### Added

- External change watching for open notes: when a `.note` file is modified outside the editor (e.g. by a git sync), the open document now updates automatically. If the editor has unsaved changes at that moment (conflict), a dialog asks which version wins: "Keep my changes" overwrites the file with the editor content, "Load from disk" reloads the document from disk and discards the unsaved edits. Closing the dialog without a choice changes nothing — local edits stay in the editor and the file stays untouched. The plugin's own autosave writes are never mistaken for external changes.

### Fixed

- Data-loss protection: a note file can no longer be silently wiped with an empty note body. Previously, if the file could not be read/parsed (e.g. a partially hydrated read right after opening the vault with restored tabs, or a truncated sync write), the editor silently fell back to an empty document which was then autosaved over the real content. Now: the note load is retried briefly, on failure an error state is shown instead of an editor (nothing is saved), and a last-resort write guard blocks saving an empty document over a file that still has content.

---

## [0.6.0] - 2026-09-07

### Added

- Nested task items (subtasks): pressing `Tab` inside a task item sinks it under the previous one, `Shift-Tab` lifts it back, and Enter continues the list at the same nesting level. Checking a parent item no longer strikes through its subtasks.
- Folding (collapsing) of subtasks, like native Obsidian outlines: a chevron to the left of a task item with nested content hides its subtasks; the item itself stays visible and editable. Fold state persists per note (like heading folds) and survives edits. Desktop only in this first iteration; on mobile subtasks can still be created and edited, without the fold chevron.
- Heading and task folding now survive aggressive edits correctly: deleting a collapsed section drops its fold instead of silently transferring it to the next section, and the caret is pushed out of a hidden region on *any* edit that lands it there (e.g. sinking a task under a collapsed parent with `Tab`), not only when folding from inside it.

---

## [0.5.0] - 2026-09-03

### Added

- Added folding (collapsing) of sections under headings, like native Obsidian notes: a chevron appears to the left of a heading that has content below it; clicking it hides everything up to the next heading of the same or higher level. The heading itself stays visible and editable, and the caret is moved out of the hidden region. Desktop only in this first iteration; mobile behavior is unchanged.
- Editor keyboard shortcuts are now layout-independent: `Cmd/Ctrl+B`, `I`, `U`, `E`, lists, headings and other formatting shortcuts work on any OS language and keyboard layout, including non-Latin ones.
- Added a trash (remove link) button next to the apply (check) button in the link menu, on both desktop and mobile. Removing a link is undoable with the standard undo.

### Fixed

- Fixed `Failed to reload note content: Cannot read properties of null (reading 'commands')` — a race where the view was unloaded (leaf switch/close) while the note file was being read; the editor is now re-checked after the read before applying external changes.
- Fixed formatting shortcuts (bold, italic, underline, etc.) not working inside notes: Obsidian's own command hotkeys consumed `Cmd/Ctrl` combos before they reached the editor, and ProseMirror bindings never matched layout-transformed keys.
- Fixed `Cmd/Ctrl+Shift+B` toggling bold instead of blockquote on non-Latin layouts.
- Fixed a possible freeze when pressing a shortcut that cannot be applied in the current context (e.g. bold inside a code block).
- Fixed the link menu action buttons (apply check, trash) being flattened into gray 44px squares on mobile by the generic mobile button overrides.

### Changed

- While a note is open, colliding Obsidian commands (Toggle bold/italics, Find in note, Insert link, Toggle preview) route their hotkeys into the note editor; outside notes they behave as before.
- Mobile (phones and tablets): the link menu no longer shows the "Enter apply · Esc cancel" keyboard hints — touch devices have no such keys. Desktop keeps the hints.

---

## [0.4.3] - 2026-08-31

### Fixed

- Fixed the selection frame around selected table cells.
- Fixed color swatches rendering as black squares on mobile.
- Fixed the active color swatch being repainted with the generic active-button fill.

### Changed

- The selection rectangle around table cells is now drawn in the accent color instead of the near-black table border, on both desktop and mobile.
- Mobile: the drag-selection circle in the corner of the selected cell is no longer shown; cell selection is done with a long-press anywhere in the cell.
- Mobile: the column-resize handle is now a wider, purely overlay grip that does not extend the table's scroll area, with a subtle square translucent guide line.
- Mobile: the "Fill & color" panel no longer floats above the toolbar as a popup. It now docks as a full-width row directly above the toolbar actions, like a native menu.

---

## [0.4.2] - 2026-08-28

### Added

- Added long-press cell selection on mobile: press and hold a table cell, then drag to select a rectangular range of cells. A subtle highlight shows the cells being picked while dragging, and a haptic tick confirms the gesture.

### Fixed

- Fixed mobile cell-selection gestures dying after the first move: a re-render during the gesture destroyed the touched element, and the WebView silently dropped the whole touch stream. The gesture now runs on pointer events captured to the editor root and no longer touches the document mid-gesture.
- Fixed the selection circle ignoring touches on its inner dot; the whole circle area (including its enlarged touch zone) now starts the cell-selection drag.
- Fixed column-resize and cell-selection gestures being interrupted by native scrolling: table cells own their touches, and swiping from a cell scrolls the note manually.
- Fixed the freshly built cell selection collapsing right after the finger lifts (the browser's synthetic mouse events no longer revert it to a caret).
- Fixed the first tap on a cell occasionally doing nothing after a cell-selection gesture.

### Changed

- Selection is now applied once, on finger lift; while dragging, the picked range is previewed with a lightweight overlay outside the editor DOM.

---

## [0.4.1] - 2026-08-27

### Fixed

- Fixed tables selection
- Fixed the tablet mobile layout: the editor no longer reserves the phone-only fixed header height (no big empty gap on top), and the top scroll-fade mask is no longer shown; both now apply to phones only. The in-note search bar also keeps its normal position on tablets.

---

## [0.4.0] - 2026-08-25

### Added

- Added in-note document search with highlighted matches and match navigation (previous/next).
- Added a **Find in note** action to the mobile More options (three-dot) menu.
- Added the `inscriptum:find-in-note` command, opened with `Cmd/Ctrl+F`, that opens the in-note search bar.
- Added a **New inscriptum** button next to the standard **New note** button in the file explorer (visible on both desktop and mobile), so notes can be created directly without opening the folder context menu or the hidden ribbon.

### Fixed

- Fixed the mobile new-note dialog stretching to full screen with empty space; it is now a compact card with the fields directly under the title.

---

## [0.3.0] - 2026-08-24

### Added

- Added a folder selector to the new Inscriptum note dialog.
- Added a **New inscriptum** action to folder context menus.

### Changed

- New notes default to the active file's folder, while still allowing another folder to be selected.
- Improved the new note dialog layout and clarified Inscriptum action labels.
- Improved TypeScript typings for commands, callbacks, dispatch, and conditional types.
- Replaced broad CSS selectors with explicit component classes where practical.
- Improved CSS compatibility with older Obsidian versions.

### Fixed

- New `.note` documents now follow the selected folder, including nested folders.
- Removed obsolete custom-element and browser-feature CSS warnings.

---

## [0.2.4] - 2026-08-23

### Fixed

- Improved code styles, fixed some warnings

---

## [0.2.3] - 2026-08-23

### Fixed

- Improved mobile keyboard detection on Android and iOS.
- Fixed mobile toolbar buttons losing the editor selection or focus.
- Fixed mobile note titles being hidden behind Obsidian's fixed view header.
- Fixed Obsidian's mobile navigation not hiding and showing while scrolling custom notes.
- Added a subtle top fade when scrolling content beneath the fixed mobile controls.
- Removed the duplicate file name from the mobile view header.

---

## [0.2.2] - 2026-08-21

### Fixed

- Fixed the mobile toolbar not appearing when the keyboard could not be detected (e.g. in desktop mobile emulation) by showing it on editor focus instead.

---

## [0.2.1] - 2026-08-21

### Changed

- On mobile, replaced the native bottom-menu integration with a dedicated bottom toolbar: on phones it appears only while the keyboard is open (the native menu shows otherwise), and on iPad it is always visible.

---

## [0.2.0] - 2026-08-21

### Added

- Added a dedicated bubble menu for images and attachments (file name, Replace, Delete) instead of the text-formatting menu.

### Changed

- On mobile, the editor toolbar and bubble menus are now integrated into Obsidian's native bottom menu, with a toggle between native controls and the editor toolbar.

### Fixed

- Fixed images not loading after restarting Obsidian (stale resource URL).
- Fixed attachments opening immediately on click instead of being selected first.

---

## [0.1.3] - 2026-08-18

### Changed

- Refactored toolbar and bubble/table menu icons to render from a single shared inline-SVG sprite (injected once at startup) instead of duplicated inline SVG per button.

### Fixed

- Fixed toolbar and bubble-menu icons not showing on iPad (iOS Safari collapsed inline `<svg>` inside flex buttons) by sizing the icons via CSS and rendering them through sprite `<use>` elements.
- Added `xlink:href` alongside `href` on every `<use>` for broader SVG compatibility.

---

## [0.1.2] - 2026-08-17

### Fixed

- Fixed plugin update and reload.

### Changed

- Improved stability and reliability.
- Updated dependencies.

---

## [0.1.1] - 2026-08-10

### Fixed

- Fixed a crash that could prevent the plugin from loading on mobile devices (Android and iOS).
- Improved compatibility with the latest Obsidian versions.
- Various under-the-hood reliability improvements.

---

## [0.1.0] - 2026-08-09

### Added

- Initial release: local-first WYSIWYG rich text editor for Obsidian.
