import type { App } from "obsidian";

const LIGHTBOX_CLASS = "inscriptum-image-lightbox";

/** Close call of the currently open overlay: replacing or sweeping the
 *  overlay must also retire its document-level keydown listener. */
let activeClose: (() => void) | null = null;

/**
 * Shared fullscreen overlay chrome. Closing model (the lightbox-gallery-zoom
 * contract, shared by every lightbox): Escape, the corner ✕ button, or a
 * click on the background outside the object — a click on the object itself
 * never closes. Cleans up its listeners.
 */
function openLightboxOverlay(
  object: HTMLElement | SVGSVGElement,
  caption?: string | null,
): void {
  closeImageLightbox();

  const overlay = createDiv();
  overlay.className = LIGHTBOX_CLASS;

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
    }
  };

  const closeButton = createEl("button", {
    cls: `${LIGHTBOX_CLASS}__close`,
    text: "✕",
    attr: { type: "button", "aria-label": "Close" },
  });
  closeButton.addEventListener("click", close);
  overlay.appendChild(closeButton);
  overlay.appendChild(object);

  let captionEl: HTMLElement | null = null;
  if (caption) {
    captionEl = createDiv();
    captionEl.className = `${LIGHTBOX_CLASS}__caption`;
    captionEl.textContent = caption;
    overlay.appendChild(captionEl);
  }

  // Background = the overlay itself and its caption strip; a click on the
  // object hits neither and stays.
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target === captionEl) close();
  });
  document.addEventListener("keydown", onKeydown, true);
  activeClose = close;

  document.body.appendChild(overlay);
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
  const img = createEl("img");
  img.src = src;
  img.alt = filename || src;

  openLightboxOverlay(img, filename);
}

/**
 * Lightbox for an already rendered inline SVG (a mermaid diagram's view
 * face): the clone is normalized to its viewBox dimensions so the overlay's
 * CSS box scales it like a raster image. Captionless — the diagram lightbox
 * carries no label (owner decision, 2026-10-12).
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
  // Mermaid pins an inline max-width that would fight the overlay's box.
  clone.removeAttribute("style");

  openLightboxOverlay(clone);
}

/** Closes the lightbox if it is open (also used before opening a new one):
 *  runs the active overlay's own close so its listeners go with it, then
 *  sweeps any stray overlay DOM. */
export function closeImageLightbox(): void {
  activeClose?.();
  document.querySelectorAll(`.${LIGHTBOX_CLASS}`).forEach((el) => el.remove());
}
