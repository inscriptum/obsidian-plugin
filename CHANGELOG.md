# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
