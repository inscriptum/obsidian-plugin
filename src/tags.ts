// Vite replaces `process.env.EDITOR_VERSION` at build time.
declare const process: {
  env: {
    EDITOR_VERSION?: string;
  };
};
/**
 * Versioned custom element tags.
 *
 * The browser's CustomElementRegistry keeps the class registered under a tag
 * name for the whole session — a tag cannot be re-registered. So when a
 * plugin update is applied without restarting Obsidian (BRAT update, dev
 * re-deploy, toggle off/on), re-running main.js would hit
 * "Failed to execute 'define' ... already been used", and the fresh classes
 * could never be constructed.
 *
 * To make every build register FRESH classes, tags are suffixed with the
 * build version (injected by vite.config.mts, see `process.env.EDITOR_VERSION`):
 *
 *   "texto-editor"        → "texto-editor-0.1.1"
 *   "texto-extension-image" → "texto-extension-image-0.1.1"
 *
 * In dev mode (`vite build --watch --mode development`) the suffix includes a
 * per-build hash, so every dev rebuild also registers new classes and a
 * plugin reload picks up the changes fully.
 *
 * The versioned tag is the REGISTRY tag (customElements.define + element
 * instantiation). HTML serialization (clipboard, export) uses the static
 * base tags instead — see the `HTML_TAG` exports in the extension files — so
 * copying between different plugin versions keeps working.
 */
/** The suffix for custom element tags (see tags.ts doc comment). */
export const TAG_VERSION = process.env.EDITOR_VERSION ?? "dev";

/** Appends the build version to a base tag name. */
export const elTag = (base: string): string => `${base}-${TAG_VERSION}`;
