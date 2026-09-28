import type { App } from "obsidian";

const LIGHTBOX_CLASS = "inscriptum-image-lightbox";

/**
 * Opens a fullscreen lightbox overlay with the image at the largest size
 * that fits the viewport. Closes on any click or Escape; cleans up its
 * listeners. Does nothing when the image file does not exist in the vault.
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
  closeImageLightbox();

  const overlay = createDiv();
  overlay.className = LIGHTBOX_CLASS;

  const img = createEl("img");
  img.src = src;
  img.alt = filename || src;
  overlay.appendChild(img);

  if (filename) {
    const caption = createDiv();
    caption.className = `${LIGHTBOX_CLASS}__caption`;
    caption.textContent = filename;
    overlay.appendChild(caption);
  }

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKeydown, true);
  };

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  overlay.addEventListener("click", close);
  document.addEventListener("keydown", onKeydown, true);

  document.body.appendChild(overlay);
}

/** Closes the lightbox if it is open (also used before opening a new one). */
export function closeImageLightbox(): void {
  document.querySelectorAll(`.${LIGHTBOX_CLASS}`).forEach((el) => el.remove());
}
