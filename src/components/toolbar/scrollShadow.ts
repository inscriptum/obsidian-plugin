/**
 * Horizontal scroll-hint helpers for the phone navbar.
 *
 * Our toolbar and the selection bars (bubble menu) scroll horizontally inside
 * the navbar. To hint that more items are reachable we fade the leading /
 * trailing edge via `can-scroll-left` / `can-scroll-right` classes (the fade
 * itself is drawn in CSS). The class state is derived from the container's
 * scroll geometry.
 */

const SCROLL_CONTAINER_SELECTOR =
  ".note-toolbar, .bubble-menu-bar__row, .bubble-menu-table-bar, .bubble-menu-media-bar";

export interface ScrollShadowState {
  canScrollLeft: boolean;
  canScrollRight: boolean;
}

/** Pure geometry → shadow-state mapping (unit-testable). */
export function computeScrollShadowState(
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
): ScrollShadowState {
  return {
    canScrollLeft: scrollLeft > 1,
    canScrollRight: scrollLeft + clientWidth < scrollWidth - 1,
  };
}

/** Reflect a container's scroll geometry onto its `can-scroll-*` classes. */
export function syncScrollShadow(el: HTMLElement): void {
  const { canScrollLeft, canScrollRight } = computeScrollShadowState(
    el.scrollLeft,
    el.scrollWidth,
    el.clientWidth,
  );
  el.classList.toggle("can-scroll-left", canScrollLeft);
  el.classList.toggle("can-scroll-right", canScrollRight);
}

/**
 * Wire scroll-shadow syncing for every scroll container inside `root`.
 * Returns a cleanup function.
 *
 * `scroll` does not bubble, so we listen in the capture phase. A
 * MutationObserver re-syncs after the toolbar ↔ selection-bar swap (which
 * changes which container is laid out) and on mode changes.
 */
export function setupScrollShadows(root: HTMLElement): () => void {
  const syncAll = () => {
    root
      .querySelectorAll<HTMLElement>(SCROLL_CONTAINER_SELECTOR)
      .forEach(syncScrollShadow);
  };

  const onScroll = (event: Event) => {
    const target = event.target as HTMLElement | null;
    if (target && target.matches?.(SCROLL_CONTAINER_SELECTOR)) {
      syncScrollShadow(target);
    }
  };

  document.addEventListener("scroll", onScroll, true);

  const observer = new MutationObserver(() => {
    window.requestAnimationFrame(syncAll);
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });

  window.addEventListener("resize", syncAll);
  window.requestAnimationFrame(syncAll);

  return () => {
    document.removeEventListener("scroll", onScroll, true);
    observer.disconnect();
    window.removeEventListener("resize", syncAll);
  };
}
