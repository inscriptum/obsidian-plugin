/**
 * Stored node attrs come from files verbatim (notes are PM JSON; pasted
 * HTML is user-supplied) and are NOT validated by the schema — anything
 * interpolated into an inline style is a CSS-injection vector (a crafted
 * value like `red; background-image: url(…)` fires requests on render).
 * Only UI-shaped values may reach an inline style; everything else renders
 * as an inert attribute.
 */

/** Hex color — what every color control in this plugin emits. */
export const SAFE_HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Numeric rgb()/rgba() — computed-style values (design fills are stored as
 *  "rgba(179, 163, 247, .16)"). Digits, dots and commas only: no url(), no
 *  extra declarations. */
export const SAFE_RGB_COLOR =
  /^rgba?\(\s*[0-9.]+\s*,\s*[0-9.]+\s*,\s*[0-9.]+\s*(?:,\s*[0-9.]+\s*)?\)$/i;

/** A color value safe for inline-style interpolation, or null. */
export function safeColorValue(value: string): string | null {
  const v = value.trim();
  if (SAFE_HEX_COLOR.test(v) || SAFE_RGB_COLOR.test(v)) {
    return v;
  }
  return null;
}
