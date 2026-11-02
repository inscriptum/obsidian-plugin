/** Block id grammar and generator — spec um-cli v0.3 §4.4.
 *
 *  Normative grammar: ^[a-z0-9]{8,12}$, recommended length 10. Ids are
 *  produced by a cryptographic generator over [a-z0-9] and checked for
 *  collisions within the note. An id never encodes position, title, type
 *  or order of its block. */

export const BLOCK_ID_PATTERN = /^[a-z0-9]{8,12}$/;

export const BLOCK_ID_LENGTH = 10;

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function isBlockId(value: unknown): value is string {
  return typeof value === "string" && BLOCK_ID_PATTERN.test(value);
}

export function generateBlockId(): string {
  // Rejection sampling keeps the alphabet uniform: 256 % 36 != 0, so raw
  // `byte % 36` would make the digits "0"–"3" ~1.6% more likely than the
  // rest of the alphabet.
  let out = "";
  while (out.length < BLOCK_ID_LENGTH) {
    const bytes = new Uint8Array(BLOCK_ID_LENGTH * 2);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= 252) continue; // 252 = 7 * 36 — drop the biased tail
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === BLOCK_ID_LENGTH) break;
    }
  }
  return out;
}

/** Generate an id that avoids everything in `used` (spec §4.4: the
 *  generator checks collisions within the note and regenerates). */
export function generateBlockIdAvoiding(used: ReadonlySet<string>): string {
  for (;;) {
    const id = generateBlockId();
    if (!used.has(id)) {
      return id;
    }
  }
}

/**
 * Legacy media HTML (pre-namespace builds) carried the vault path in
 * data-id — the DOM key that now belongs to block ids. Accept a legacy
 * value only when it cannot BE a block id: real vault paths carry a
 * separator or an extension, block ids are ^[a-z0-9]{8,12}$. A
 * placeholder image (no data.id) renders its block id as data-id —
 * parsing that back as a vault path would persist a "File not found"
 * into the note.
 *
 * Accepted trade-off (review CR-30): a hypothetical extensionless vault
 * path whose bare name matches the grammar would be dropped here. Vault
 * media files always carry extensions in practice; the loss is
 * recoverable (the image shows as missing, the note still opens), and a
 * console.warn would fire on the COMMON placeholder round-trip — pure
 * noise — so no log is emitted. */
export function legacyMediaPath(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  return isBlockId(value) ? null : value;
}
