/**
 * Opaque, sortable unique identifiers for notes and assets (spec 8.1:
 * "implementations SHOULD use opaque identifiers"). ULID shape: 48-bit
 * millisecond timestamp + 80 bits of randomness, Crockford base32, 26 chars.
 * Lexicographic order equals creation order, which keeps manifests stable
 * and human-scannable.
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10;
const RANDOM_LEN = 16;

let lastTime = 0;
/** Monotonicity within the same millisecond: increment the random part so
 *  two IDs generated in one tick never collide and keep their order. */
let lastRandom: number[] = [];

function randomBits(length: number): number[] {
  const out: number[] = new Array<number>(length);
  const bytes = new Uint8Array(length);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  for (let i = 0; i < length; i++) {
    out[i] = bytes[i] % 32;
  }
  return out;
}

function increment(values: number[]): number[] {
  const out = values.slice();
  for (let i = out.length - 1; i >= 0; i--) {
    out[i] += 1;
    if (out[i] < 32) return out;
    out[i] = 0;
  }
  // 80 bits overflowed — astronomically unlikely; start fresh.
  return randomBits(out.length);
}

export function generateUmId(now = Date.now()): string {
  let time = now;
  let random: number[];
  if (time === lastTime) {
    random = increment(lastRandom);
  } else {
    random = randomBits(RANDOM_LEN);
  }
  lastTime = time;
  lastRandom = random;

  let id = "";
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    id = ENCODING[time % 32] + id;
    time = Math.floor(time / 32);
  }
  for (const bits of random) {
    id += ENCODING[bits];
  }
  return id;
}

/** Strict ULID-shape check used to tell packed asset ids apart from vault
 *  paths in image node `data.id` (a vault path always contains "/" or "."). */
export function isUmId(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== TIME_LEN + RANDOM_LEN) {
    return false;
  }
  for (const ch of value) {
    if (!ENCODING.includes(ch)) return false;
  }
  return true;
}
