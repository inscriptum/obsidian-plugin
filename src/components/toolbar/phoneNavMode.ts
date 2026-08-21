/**
 * Phone navbar integration — pure helpers.
 *
 * On phones Obsidian renders a fixed `.mobile-navbar.mod-raised`. We reuse it
 * as the container for our editor toolbar: a toggle injected into the navbar
 * swaps between Obsidian's native controls (`native` mode) and our editor
 * toolbar docked inside the same navbar (`our` mode).
 *
 * The mode is kept pure here so it can be unit-tested without spinning up the
 * whole NoteView / editor. NoteView owns the DOM wiring and persistence.
 */

export type PhoneNavMode = "our" | "native";

/** localStorage key for the persisted mode choice (survives reloads). */
export const NAV_MODE_STORAGE_KEY = "inscriptum.phoneNavMode";

/** Default mode when nothing is persisted yet. */
export const DEFAULT_PHONE_NAV_MODE: PhoneNavMode = "our";

/** Toggle to the opposite mode. */
export function nextPhoneNavMode(mode: PhoneNavMode): PhoneNavMode {
  return mode === "our" ? "native" : "our";
}

/** Coerce an arbitrary stored string into a valid mode (unknown → default). */
export function parsePhoneNavMode(value: string | null | undefined): PhoneNavMode {
  return value === "native" ? "native" : DEFAULT_PHONE_NAV_MODE;
}
