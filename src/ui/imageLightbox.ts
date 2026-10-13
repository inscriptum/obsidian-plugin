import type { App } from "obsidian";
import { Platform } from "obsidian";

const LIGHTBOX_CLASS = "inscriptum-image-lightbox";

/**
 * One viewable picture of the document: resolved source plus its label.
 * `id` is the stable reference (vault path / container asset id) used for
 * the gallery order, dedupe and finding the clicked node's position.
 */
export interface GalleryItem {
  id: string;
  src: string;
  filename?: string | null;
}

/** Close call of the currently open overlay: replacing or sweeping the
 *  overlay must also retire its document-level keydown listener. */
let activeClose: (() => void) | null = null;

// ── Transform math (pure — unit-tested without layout) ─────────────────────

/** Viewer transform: CSS `translate(x, y) scale(s)` around the image center
 *  (scale 1 = the fit-the-viewport base size). */
export interface ViewerTransform {
  scale: number;
  x: number;
  y: number;
}

export const MIN_SCALE = 1;
export const MAX_SCALE = 16;
/** Wheel zoom speed: factor = exp(-deltaY * RATE) (deltaY 100 ≈ ×0.86). */
export const WHEEL_ZOOM_RATE = 0.0015;
/** Trackpad pinch arrives as wheel events with ctrlKey — step them harder. */
export const PINCH_WHEEL_RATE = 0.01;
export const BUTTON_ZOOM_FACTOR = 1.25;
/** While panning, keep at least this many pixels of the picture on screen. */
export const PAN_KEEP_PX = 80;

export function identityTransform(): ViewerTransform {
  return { scale: 1, x: 0, y: 0 };
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** A plain pixel size from an attribute — rejects "100%", "auto", junk. */
function finiteSize(raw: string | null): number {
  const value = Number.parseFloat(raw ?? "");
  return Number.isFinite(value) && value >= 1 ? value : 0;
}

/**
 * Multiplies the scale by `factor`, keeping the content point under the
 * viewport `focal` pinned (the standard zoom-at-cursor contract). Scaling
 * back down to fit snaps to the identity — a fit picture is always centered,
 * so no un-reachable leftover pan remains.
 */
export function zoomTransform(
  t: ViewerTransform,
  factor: number,
  focal: { x: number; y: number },
  center: { x: number; y: number },
): ViewerTransform {
  const scale = clampScale(t.scale * factor);
  if (scale === t.scale) return { ...t };
  if (scale === MIN_SCALE) return identityTransform();
  // the content point under the focal: p = (focal - center - t) / scale
  const px = (focal.x - center.x - t.x) / t.scale;
  const py = (focal.y - center.y - t.y) / t.scale;
  return {
    scale,
    x: focal.x - center.x - px * scale,
    y: focal.y - center.y - py * scale,
  };
}

/**
 * Clamps a transform's translation so the scaled picture never leaves the
 * screen completely: the transformed image box must keep `PAN_KEEP_PX` of
 * overlap with the viewport on both axes.
 */
export function clampTranslate(
  t: ViewerTransform,
  imageSize: { width: number; height: number },
  viewport: { width: number; height: number },
): ViewerTransform {
  const halfW = (imageSize.width * t.scale) / 2;
  const halfH = (imageSize.height * t.scale) / 2;
  const limitX = Math.max(0, viewport.width / 2 + halfW - PAN_KEEP_PX);
  const limitY = Math.max(0, viewport.height / 2 + halfH - PAN_KEEP_PX);
  const clamp = (value: number, limit: number) =>
    Math.min(limit, Math.max(-limit, value));
  return {
    scale: t.scale,
    x: clamp(t.x, limitX),
    y: clamp(t.y, limitY),
  };
}

/**
 * Pans by (dx, dy), clamped so the scaled picture never leaves the screen
 * completely (see clampTranslate).
 */
export function panTransform(
  t: ViewerTransform,
  dx: number,
  dy: number,
  imageSize: { width: number; height: number },
  viewport: { width: number; height: number },
): ViewerTransform {
  return clampTranslate(
    { scale: t.scale, x: t.x + dx, y: t.y + dy },
    imageSize,
    viewport,
  );
}

/**
 * Pinch zoom: `ratio` is the current-to-start finger distance, and the
 * content point that sat under the fingers at pinch start (computed from
 * `focalStart`) follows the fingers' current midpoint `focalNow` — a
 * two-finger drag pans instead of repelling the picture. The result is
 * clamped like a pan (see clampTranslate).
 */
export function pinchTransform(
  start: ViewerTransform,
  ratio: number,
  focalStart: { x: number; y: number },
  focalNow: { x: number; y: number },
  center: { x: number; y: number },
  imageSize: { width: number; height: number },
  viewport: { width: number; height: number },
): ViewerTransform {
  const scale = clampScale(start.scale * ratio);
  const contentX = (focalStart.x - center.x - start.x) / start.scale;
  const contentY = (focalStart.y - center.y - start.y) / start.scale;
  return clampTranslate(
    {
      scale,
      x: focalNow.x - center.x - contentX * scale,
      y: focalNow.y - center.y - contentY * scale,
    },
    imageSize,
    viewport,
  );
}

/**
 * Gallery assembly from a document: images in document order, only the ones
 * the resolver reports available (missing files and errors never enter —
 * the same contract as the single-item lightbox), deduplicated by id
 * (a picture pasted twice is one gallery item, at its first position).
 */
export function collectGalleryItems(
  doc: {
    descendants(
      callback: (node: {
        type: { name: string };
        attrs: { data?: { id?: string | null; filename?: string | null } | null };
      }) => boolean,
    ): void;
  } | null,
  resolve: (data: {
    id?: string | null;
    filename?: string | null;
  }) => string | null,
): GalleryItem[] {
  const items: GalleryItem[] = [];
  const seen = new Set<string>();
  doc?.descendants((node) => {
    if (node.type.name !== "image") return true;
    const data = node.attrs.data;
    if (data?.id == null || seen.has(data.id)) return true;
    const src = resolve(data);
    if (src == null) return true;
    seen.add(data.id);
    items.push({ id: data.id, src, filename: data.filename });
    return true;
  });
  return items;
}

// ── Overlay ────────────────────────────────────────────────────────────────

interface ViewerHandle {
  overlay: HTMLElement;
  object: HTMLElement | SVGSVGElement;
  captionEl: HTMLElement;
  counterEl: HTMLElement | null;
  state: { transform: ViewerTransform };
  close(): void;
  render(): void;
  resetTransform(): void;
  viewportCenter(): { x: number; y: number };
  imageCenter(): { x: number; y: number };
  fitRect(): { width: number; height: number };
  zoomBy(factor: number, focal: { x: number; y: number }): void;
}

/**
 * The shared fullscreen viewer chrome, one factory for every lightbox
 * (images, galleries, diagrams). Zoom lives here: wheel at the cursor,
 * the +/− buttons, double-click fit↔100% and touch pinch, with drag
 * panning while zoomed. Closing model: Escape, the corner ✕, or a click
 * on the background outside the object — the object itself never closes.
 * Cleans up its listeners.
 */
function openViewerOverlay(
  object: HTMLElement | SVGSVGElement,
  opts: {
    /** Created when provided; the gallery manages its text per item. */
    caption?: string | null;
    /** The n/N slot in the zoom bar (hidden for the single-object viewer). */
    counter?: boolean;
    /** Extra keys (the gallery's arrows); Escape is handled here. */
    onKeydown?: (event: KeyboardEvent) => void;
  } = {},
): ViewerHandle {
  closeImageLightbox();
  // Release focus: on mobile the keyboard must not sit under the viewer,
  // and on desktop an invisible focused editor would keep eating keystrokes
  // meant for nothing. The selection stays in ProseMirror state.
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }

  const state = { transform: identityTransform() };

  const overlay = createDiv();
  overlay.className = LIGHTBOX_CLASS;
  // Mobile placement hooks (the close button clears the app's top strip —
  // see styles/image.css); the overlay lives on body, outside the view
  // container, so the platform tag must travel with it.
  if (Platform.isMobile) {
    overlay.classList.add(`${LIGHTBOX_CLASS}--mobile`);
  }

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKeydown, true);
    if (activeClose === close) activeClose = null;
  };

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    opts.onKeydown?.(event);
  };

  const closeButton = createEl("button", {
    cls: `${LIGHTBOX_CLASS}__close`,
    text: "✕",
    attr: { type: "button", "aria-label": "Close" },
  });
  closeButton.addEventListener("click", close);
  overlay.appendChild(closeButton);
  overlay.appendChild(object);

  const captionEl = createDiv();
  captionEl.className = `${LIGHTBOX_CLASS}__caption`;
  if (opts.caption !== undefined) {
    overlay.appendChild(captionEl);
  }

  // Zoom bar: − n/N + (bottom center). Wheel, double-click and pinch do the
  // same job by gesture; the buttons are the always-visible entry.
  const bar = createDiv();
  bar.className = `${LIGHTBOX_CLASS}__bar`;
  const zoomOutButton = createEl("button", {
    cls: `${LIGHTBOX_CLASS}__zoom`,
    text: "−",
    attr: { type: "button", "aria-label": "Zoom out" },
  });
  const counterEl = opts.counter
    ? createSpan({ cls: `${LIGHTBOX_CLASS}__counter` })
    : null;
  const zoomInButton = createEl("button", {
    cls: `${LIGHTBOX_CLASS}__zoom`,
    text: "+",
    attr: { type: "button", "aria-label": "Zoom in" },
  });
  if (counterEl) bar.appendChild(counterEl);
  bar.prepend(zoomOutButton);
  bar.appendChild(zoomInButton);
  overlay.appendChild(bar);

  // ── transform rendering & gestures ──

  const render = () => {
    const t = state.transform;
    object.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.scale})`;
    overlay.classList.toggle("is-zoomed", t.scale > 1);
    overlay.classList.toggle("is-panning", panning);
  };

  const viewportCenter = () => ({
    x: overlay.clientWidth / 2,
    y: overlay.clientHeight / 2,
  });

  /** The object's transform center: its untransformed box center (the caption
   *  and the bar shift the flex center, so the live rect is the source). */
  const imageCenter = () => {
    const rect = object.getBoundingClientRect();
    const origin = overlay.getBoundingClientRect();
    const t = state.transform;
    return {
      x: rect.left - origin.left + rect.width / 2 - t.x,
      y: rect.top - origin.top + rect.height / 2 - t.y,
    };
  };

  /** The object's untransformed layout box (the scale-1 fit size). */
  const fitRect = () => {
    const rect = object.getBoundingClientRect();
    const t = state.transform;
    return {
      width: rect.width / t.scale,
      height: rect.height / t.scale,
    };
  };

  const zoomBy = (factor: number, focal: { x: number; y: number }) => {
    state.transform = zoomTransform(
      state.transform,
      factor,
      focal,
      imageCenter(),
    );
    render();
  };

  const resetTransform = () => {
    state.transform = identityTransform();
    panning = false;
    pinchStart = null;
    dragStart = null;
    render();
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const rect = overlay.getBoundingClientRect();
    // normalize line-mode deltas (deltaMode 1) to pixels
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
    const rate = event.ctrlKey ? PINCH_WHEEL_RATE : WHEEL_ZOOM_RATE;
    zoomBy(Math.exp(-delta * rate), {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  };

  /** The object's natural pixel width — "100%" for the double-click toggle
   *  (a diagram's natural size is its normalized viewBox width). */
  const naturalWidth = () =>
    object instanceof SVGSVGElement
      ? finiteSize(object.getAttribute("width"))
      : (object as HTMLImageElement).naturalWidth;

  const onDoubleClick = (event: MouseEvent) => {
    event.preventDefault();
    // toggle fit (scale 1) ↔ actual size (natural pixels over fit pixels)
    const target =
      state.transform.scale > 1
        ? 1
        : clampScale(naturalWidth() / (fitRect().width || 1));
    zoomBy(target / state.transform.scale, viewportCenter());
  };

  // Pointer gestures on the object: drag pans while zoomed; two touch
  // pointers pinch. Clicks stay no-ops (the closing model).
  const pointers = new Map<number, { x: number; y: number }>();
  let panning = false;
  let pinchStart: {
    distance: number;
    transform: ViewerTransform;
    mid: { x: number; y: number };
  } | null = null;
  let dragStart: { x: number; y: number; transform: ViewerTransform } | null =
    null;

  const onPointerDown = (event: PointerEvent) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const origin = overlay.getBoundingClientRect();
      pinchStart = {
        distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        transform: state.transform,
        mid: {
          x: (a.x + b.x) / 2 - origin.left,
          y: (a.y + b.y) / 2 - origin.top,
        },
      };
      dragStart = null;
    } else if (pointers.size === 1) {
      dragStart = {
        x: event.clientX,
        y: event.clientY,
        transform: state.transform,
      };
    }
    // pointer capture keeps moves/up on the object even off its bounds;
    // synthetic pointers (tests, automation) are not capturable — the
    // gesture state above must survive that
    try {
      object.setPointerCapture?.(event.pointerId);
    } catch {
      /* not a real pointer — fine */
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 2 && pinchStart != null) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const origin = overlay.getBoundingClientRect();
      const mid = {
        x: (a.x + b.x) / 2 - origin.left,
        y: (a.y + b.y) / 2 - origin.top,
      };
      const rect = overlay.getBoundingClientRect();
      state.transform = pinchTransform(
        pinchStart.transform,
        distance / pinchStart.distance,
        pinchStart.mid,
        mid,
        imageCenter(),
        fitRect(),
        { width: rect.width, height: rect.height },
      );
      render();
      return;
    }

    if (pointers.size === 1 && dragStart != null) {
      if (state.transform.scale <= 1) return; // panning needs a zoomed object
      const rect = overlay.getBoundingClientRect();
      const t = dragStart.transform;
      state.transform = panTransform(
        t,
        event.clientX - dragStart.x,
        event.clientY - dragStart.y,
        fitRect(),
        { width: rect.width, height: rect.height },
      );
      panning = true;
      render();
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 1) {
      // a pinch ended with one finger still down — it becomes the drag
      const [rest] = [...pointers.values()];
      dragStart = { x: rest.x, y: rest.y, transform: state.transform };
      panning = false;
    } else {
      dragStart = null;
      panning = false;
      render();
    }
  };

  const wire = object as HTMLElement;
  wire.addEventListener("wheel", onWheel, { passive: false });
  wire.addEventListener("dblclick", onDoubleClick);
  wire.addEventListener("pointerdown", onPointerDown);
  wire.addEventListener("pointermove", onPointerMove);
  wire.addEventListener("pointerup", onPointerUp);
  wire.addEventListener("pointercancel", onPointerUp);

  zoomOutButton.addEventListener("click", () => {
    zoomBy(1 / BUTTON_ZOOM_FACTOR, imageCenter());
  });
  zoomInButton.addEventListener("click", () => {
    zoomBy(BUTTON_ZOOM_FACTOR, imageCenter());
  });

  // Background = the overlay surface itself; a click on the object, its
  // caption, the bar or the arrows hits neither and stays.
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", onKeydown, true);
  activeClose = close;

  document.body.appendChild(overlay);
  render();

  return {
    overlay,
    object,
    captionEl,
    counterEl,
    state,
    close,
    render,
    resetTransform,
    viewportCenter,
    imageCenter,
    fitRect,
    zoomBy,
  };
}

/**
 * Opens a fullscreen lightbox overlay with the image at the largest size
 * that fits the viewport. Does nothing when the image file does not exist
 * in the vault.
 */
export function openImageLightbox(
  app: App,
  imageId: string,
  filename?: string | null,
): void {
  if (app.vault.getAbstractFileByPath(imageId) == null) {
    return;
  }
  openImageLightboxFromUrl(
    app.vault.adapter.getResourcePath(imageId),
    filename ?? imageId,
  );
}

/** Lightbox for an image that already has a usable URL (e.g. a container
 *  asset's object URL — no vault file involved). */
export function openImageLightboxFromUrl(
  src: string,
  filename?: string | null,
): void {
  openImageGallery([{ id: src, src, filename }], 0);
}

/**
 * The editor's picture viewer: the gallery of the document's images with
 * next/prev (looping edges, arrows + keyboard), zoom (wheel, +/− buttons,
 * double-click fit/100%, pinch on touch) and drag panning while zoomed.
 * Only `items[index]` is guaranteed to be the clicked picture; every item
 * must already be resolved and available. A single-item gallery is the old
 * minimal lightbox plus the zoom bar.
 */
export function openImageGallery(items: GalleryItem[], index: number): void {
  if (items.length === 0) return;
  // a picture that fails to load leaves the gallery (see the img error
  // handler below) — the list shrinks and the counter follows
  const gallery = items.slice();

  const img = createEl("img");
  img.draggable = false;

  let currentIndex = Math.min(Math.max(index, 0), items.length - 1);
  const viewer = openViewerOverlay(img, {
    caption: "",
    counter: true,
    onKeydown: (event) => {
      if (gallery.length <= 1) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        show(currentIndex + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        show(currentIndex - 1);
      }
    },
  });
  const { overlay, captionEl, counterEl } = viewer;

  const show = (index: number) => {
    // looping edges (owner decision): both directions wrap around
    const next = ((index % gallery.length) + gallery.length) % gallery.length;
    currentIndex = next;
    // a new picture starts unzoomed and unpanned
    viewer.resetTransform();
    const item = gallery[next];
    img.src = item.src;
    img.alt = item.filename || item.src;
    captionEl.textContent = item.filename ?? "";
    captionEl.style.display = item.filename ? "" : "none";
    if (counterEl) counterEl.textContent = `${next + 1} / ${gallery.length}`;
  };

  // Availability contract: a picture that cannot load takes no part in the
  // gallery. Drop it and move to a neighbor; the last one closing the view.
  img.addEventListener("error", () => {
    gallery.splice(currentIndex, 1);
    if (gallery.length === 0) {
      viewer.close();
      return;
    }
    show(currentIndex);
  });

  const prevButton =
    gallery.length > 1
      ? createEl("button", {
          cls: `${LIGHTBOX_CLASS}__prev`,
          text: "‹",
          attr: { type: "button", "aria-label": "Previous image" },
        })
      : null;
  const nextButton =
    gallery.length > 1
      ? createEl("button", {
          cls: `${LIGHTBOX_CLASS}__next`,
          text: "›",
          attr: { type: "button", "aria-label": "Next image" },
        })
      : null;
  prevButton?.addEventListener("click", () => show(currentIndex - 1));
  nextButton?.addEventListener("click", () => show(currentIndex + 1));
  if (prevButton) overlay.appendChild(prevButton);
  if (nextButton) overlay.appendChild(nextButton);

  show(currentIndex);
}

/**
 * Lightbox for an already rendered inline SVG (a mermaid diagram's view
 * face): the same viewer as images — zoom bar, wheel, double-click and
 * pinch — without the gallery (diagrams stay outside it, owner decision,
 * 2026-10-13) and without a caption (owner decision, 2026-10-12). The clone
 * is normalized to its viewBox dimensions so the viewer's box scales it
 * like a raster image; its natural size is the viewBox size.
 */
export function openSvgLightbox(svg: SVGSVGElement): void {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const box = (clone.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    box.length === 4 &&
    box.every((n) => Number.isFinite(n)) &&
    box[2] > 0 &&
    box[3] > 0
  ) {
    clone.setAttribute("width", String(box[2]));
    clone.setAttribute("height", String(box[3]));
  }
  // Mermaid pins an inline max-width that would fight the viewer's box.
  clone.removeAttribute("style");

  openViewerOverlay(clone);
}

/** Closes the lightbox if it is open (also used before opening a new one):
 *  runs the active overlay's own close so its listeners go with it, then
 *  sweeps any stray overlay DOM. */
export function closeImageLightbox(): void {
  activeClose?.();
  document.querySelectorAll(`.${LIGHTBOX_CLASS}`).forEach((el) => el.remove());
}
