# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
