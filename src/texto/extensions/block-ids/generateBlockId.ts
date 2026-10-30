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
  const bytes = new Uint8Array(BLOCK_ID_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < BLOCK_ID_LENGTH; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
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
