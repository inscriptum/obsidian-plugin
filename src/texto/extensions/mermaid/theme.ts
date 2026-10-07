/**
 * Theme-change signal for the mermaid renderer.
 *
 * The plugin does not subscribe to Obsidian theme events (NoteView is a
 * FileView); the established pattern is a body-class MutationObserver — the
 * same signal the hljs theme uses (see NoteView.ts). mermaid computes colors
 * at render time, so a theme flip must re-render visible diagrams.
 */

export type ThemeListener = (isLight: boolean) => void;

function isLightTheme(): boolean {
  return document.body.classList.contains("theme-light");
}

const listeners = new Set<ThemeListener>();
let observer: MutationObserver | null = null;

/** Current app theme, as far as mermaid theming is concerned. */
export function isLightThemeNow(): boolean {
  return isLightTheme();
}

/** Subscribe to app theme flips; returns an unsubscribe function. */
export function onThemeChange(listener: ThemeListener): () => void {
  listeners.add(listener);
  if (observer == null) {
    observer = new MutationObserver(() => {
      const light = isLightTheme();
      for (const fn of listeners) fn(light);
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }
  return () => {
    listeners.delete(listener);
  };
}
