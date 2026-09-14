/**
 * Full-bleed layout for images: stretches an image across the whole editor
 * scroll container (edge to edge of the note pane), countering the editor
 * content indent with a negative margin.
 *
 * The required offsets depend on the live layout (reading width, paddings,
 * centered content), so the geometry is measured from the DOM and re-applied
 * whenever the scroll container resizes.
 */

const fullBleedElements = new Set<HTMLElement>();
const observedContainers = new WeakSet<HTMLElement>();

function apply(el: HTMLElement): void {
  const container = el.closest(".texto-editor") as HTMLElement | null;
  if (container == null) return;

  const elRect = el.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  if (containerRect.width <= 0) return;

  // clientWidth excludes the vertical scrollbar, so the image never
  // triggers a horizontal scrollbar.
  const width = container.clientWidth;
  const offset = elRect.left - containerRect.left;

  el.style.width = `${width}px`;
  el.style.marginLeft = `${-offset}px`;
}

function onResize(): void {
  for (const el of [...fullBleedElements]) {
    if (!el.isConnected) {
      fullBleedElements.delete(el);
      continue;
    }
    apply(el);
  }
}

const resizeObserver =
  typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
let windowResizeFallback = false;

/** Marks the element as full-bleed and measures/applies the geometry. */
export function applyFullBleed(el: HTMLElement): void {
  fullBleedElements.add(el);

  const container = el.closest(".texto-editor") as HTMLElement | null;
  if (container != null && !observedContainers.has(container)) {
    observedContainers.add(container);
    if (resizeObserver != null) {
      resizeObserver.observe(container);
    } else if (!windowResizeFallback) {
      // jsdom/test environments without ResizeObserver: coarse fallback.
      windowResizeFallback = true;
      window.addEventListener("resize", onResize);
    }
  }

  // Measure synchronously: getBoundingClientRect forces a layout flush with
  // the freshly applied attrs. Do NOT rely solely on rAF — in Obsidian a
  // background/occluded window throttles rAF to a halt and the geometry
  // would never be applied.
  apply(el);
}

/** Removes the element from full-bleed tracking and clears inline styles. */
export function releaseFullBleed(el: HTMLElement): void {
  if (!fullBleedElements.delete(el)) {
    return;
  }
  el.style.width = "";
  el.style.marginLeft = "";
}
