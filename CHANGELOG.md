# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Fixed the selection frame around selected table cells.
- Fixed color swatches rendering as black squares on mobile.
- Fixed the active color swatch being repainted with the generic active-button fill.

### Changed

- The selection rectangle around table cells is now drawn in the accent color instead of the near-black table border, on both desktop and mobile.
- Mobile: the drag-selection circle in the corner of the selected cell is no longer shown; cell selection is done with a long-press anywhere in the cell.
- Mobile: the column-resize handle is now a wider, purely overlay grip that does not extend the table's scroll area, with a subtle square translucent guide line.
- Mobile: the "Fill & color" panel no longer floats above the toolbar as a popup. It now docks as a full-width row directly above the toolbar actions, like a native menu.

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

## [0.4.1] - 2026-08-27

### Fixed

- Fixed tables selection
- Fixed the tablet mobile layout: the editor no longer reserves the phone-only fixed header height (no big empty gap on top), and the top scroll-fade mask is no longer shown; both now apply to phones only. The in-note search bar also keeps its normal position on tablets.

## [0.4.0] - 2026-08-25

### Added

- Added in-note document search with highlighted matches and match navigation (previous/next).
- Added a **Find in note** action to the mobile More options (three-dot) menu.
- Added the `inscriptum:find-in-note` command, opened with `Cmd/Ctrl+F`, that opens the in-note search bar.
- Added a **New inscriptum** button next to the standard **New note** button in the file explorer (visible on both desktop and mobile), so notes can be created directly without opening the folder context menu or the hidden ribbon.

### Fixed

- Fixed the mobile new-note dialog stretching to full screen with empty space; it is now a compact card with the fields directly under the title.

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

## [0.2.4] - 2026-08-23

### Fixed

- Improved code styles, fixed some warnings

## [0.2.3] - 2026-08-23

### Fixed

- Improved mobile keyboard detection on Android and iOS.
- Fixed mobile toolbar buttons losing the editor selection or focus.
- Fixed mobile note titles being hidden behind Obsidian's fixed view header.
- Fixed Obsidian's mobile navigation not hiding and showing while scrolling custom notes.
- Added a subtle top fade when scrolling content beneath the fixed mobile controls.
- Removed the duplicate file name from the mobile view header.

## [0.2.2] - 2026-08-21

### Fixed

- Fixed the mobile toolbar not appearing when the keyboard could not be detected (e.g. in desktop mobile emulation) by showing it on editor focus instead.

## [0.2.1] - 2026-08-21

### Changed

- On mobile, replaced the native bottom-menu integration with a dedicated bottom toolbar: on phones it appears only while the keyboard is open (the native menu shows otherwise), and on iPad it is always visible.

## [0.2.0] - 2026-08-21

### Added

- Added a dedicated bubble menu for images and attachments (file name, Replace, Delete) instead of the text-formatting menu.

### Changed

- On mobile, the editor toolbar and bubble menus are now integrated into Obsidian's native bottom menu, with a toggle between native controls and the editor toolbar.

### Fixed

- Fixed images not loading after restarting Obsidian (stale resource URL).
- Fixed attachments opening immediately on click instead of being selected first.

## [0.1.3] - 2026-08-18

### Changed

- Refactored toolbar and bubble/table menu icons to render from a single shared inline-SVG sprite (injected once at startup) instead of duplicated inline SVG per button.

### Fixed

- Fixed toolbar and bubble-menu icons not showing on iPad (iOS Safari collapsed inline `<svg>` inside flex buttons) by sizing the icons via CSS and rendering them through sprite `<use>` elements.
- Added `xlink:href` alongside `href` on every `<use>` for broader SVG compatibility.

## [0.1.2] - 2026-08-17

### Fixed

- Fixed plugin update and reload.

### Changed

- Improved stability and reliability.
- Updated dependencies.

## [0.1.1] - 2026-08-10

### Fixed

- Fixed a crash that could prevent the plugin from loading on mobile devices (Android and iOS).
- Improved compatibility with the latest Obsidian versions.
- Various under-the-hood reliability improvements.

## [0.1.0] - 2026-08-09

### Added

- Initial release: local-first WYSIWYG rich text editor for Obsidian.
