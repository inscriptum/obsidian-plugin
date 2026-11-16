import { BORDER_COLORS, isHexColor } from "./tableMenuState";

/**
 * The custom-color row shared by all four color layers (text styles, table
 * fill, table border pen, table cells text): the native `input[type=color]`
 * + hex field on fine pointers, an in-DOM color popup on coarse pointers.
 *
 * Why the native picker is replaced on mobile (task mobile-color-picker-closes,
 * diagnosed on the Android emulator, scripts/debug/diag-color-picker-android.mjs):
 * tapping `input[type=color]` moves focus off the editable → the soft keyboard
 * hides → NoteView removes `.is-keyboard-open` → mobile.css hides the whole
 * `.note-toolbar-host` (phones: toolbar visible only while the keyboard is
 * up) → the bar, the layer and the just-opened dialog die together. The
 * WebView also dismisses native pickers on keyboard hide (same mechanism as
 * codeBlockSelectLang) and `showPicker()` is a silent no-op there — so the
 * native dialog is unrecoverable, and the tap never even reaches the input
 * (Obsidian's shell-level `mobile-tap` interception). The in-DOM popup keeps
 * every control a plain button or an editable input: buttons never steal
 * focus (the toolbar host preventDefaults them), the hex field keeps the
 * keyboard open — so the host, layer and popup all survive the interaction.
 *
 * The popup is position:fixed and coordinates are computed at open time: the
 * docked mobile layer is a scroll container (overflow-y: auto) and would
 * clip an absolutely-positioned popup anchored to the row.
 *
 * Popup visibility is toggled by class (same pattern as codeBlockSelectLang),
 * not by re-render. Swatch colors are hex computed in JS — stored values stay
 * plain hex (unlike color-mix strings).
 */

/** Shades for the popup grid, derived from the unified palette (one source
 *  of truth, BORDER_COLORS): light → base → dark per column. */
const BASE_COLORS = BORDER_COLORS.filter((c) => c.color != null) as Array<{
  label: string;
  color: string;
}>;

function mixHex(hex: string, target: [number, number, number], amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const parts = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(
    (c, i) => Math.round(c + (target[i] - c) * amount),
  );
  return `#${parts.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

/** The unified palette's 11 colors × three shades each, column-major:
 *  light → base → dark stay together per color. The desktop CSS grid is
 *  unreachable (fine pointers render the native branch); on the mobile
 *  5-column grid each color keeps its three shades side by side. */
const PICKER_GRID: Array<{ color: string; label: string }> = BASE_COLORS.flatMap((c) => [
  { color: mixHex(c.color, WHITE, 0.45), label: `${c.label} light` },
  { color: c.color, label: c.label },
  { color: mixHex(c.color, BLACK, 0.35), label: `${c.label} dark` },
]);

const stopBubbling = (e: Event) => e.stopPropagation();

// One shared capture-phase listener closes any open popup on a tap outside
// the custom row; taps inside a row are handled by that row's own controls.
let outsideCloseWired = false;
function wireOutsideClose(): void {
  if (outsideCloseWired) return;
  outsideCloseWired = true;
  document.addEventListener(
    "pointerdown",
    (e) => {
      const t = e.target;
      if (t instanceof Element && t.closest(".bb-dd-custom")) return;
      for (const p of document.querySelectorAll<HTMLElement>(".bb-dd-popup.show")) {
        p.classList.remove("show");
      }
    },
    true,
  );
}

const closePopups = (): void => {
  for (const p of document.querySelectorAll<HTMLElement>(".bb-dd-popup.show")) {
    p.classList.remove("show");
  }
};

function hexField(label: string, onApply: (hex: string) => void) {
  return (
    <input
      type="text"
      class="bb-dd-hex"
      placeholder="#rrggbb"
      maxlength={7}
      spellcheck={false}
      aria-label={label}
      onmousedown={stopBubbling}
      onkeydown={(e: KeyboardEvent) => {
        if (e.key !== "Enter") return;
        const input = e.target as HTMLInputElement;
        if (isHexColor(input.value)) {
          onApply(input.value.trim().toLowerCase());
        }
      }}
    ></input>
  );
}

export function customColorRow(opts: {
  /** Current color expanded to 6-digit hex (pickerHexValue). */
  value: string;
  /** aria-label for the hex field (the native input keeps title="Custom color"). */
  hexLabel: string;
  onApply: (hex: string) => void;
}) {
  // Detected at render: the host does not move between mobile and desktop
  // contexts during a view's lifetime (same pattern as codeBlockSelectLang).
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;

  if (!coarse) {
    return (
      <div class="bb-dd-custom">
        <input
          type="color"
          value={opts.value}
          title="Custom color"
          onmousedown={stopBubbling}
          onchange={(e: Event) =>
            opts.onApply((e.target as HTMLInputElement).value)
          }
        ></input>
        {hexField(opts.hexLabel, opts.onApply)}
      </div>
    );
  }

  // The popup only exists on coarse pointers, so the outside-close listener
  // is wired there and never on desktop.
  wireOutsideClose();

  return (
    <div class="bb-dd-custom bb-dd-custom--coarse">
      <button
        class="bb-dd-open"
        style={`background: ${opts.value}`}
        aria-label="Custom color"
        data-tip="Custom color"
        onclick={(e: Event) => {
          const btn = e.currentTarget as HTMLElement;
          const popup = btn.parentElement?.querySelector<HTMLElement>(
            ".bb-dd-popup",
          );
          if (!popup) return;
          const willOpen = !popup.classList.contains("show");
          closePopups();
          if (!willOpen) return;
          popup.classList.add("show");
          // Fixed placement above the button, clamped to the viewport; the
          // toolbar sits at the screen bottom on mobile, so up is the room.
          const r = btn.getBoundingClientRect();
          const pw = popup.offsetWidth;
          const ph = popup.offsetHeight;
          popup.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - pw - 8))}px`;
          popup.style.top = `${Math.max(8, r.top - ph - 8)}px`;
        }}
      ></button>
      <div class="bb-dd-popup">
        {PICKER_GRID.map((sw) => (
          <button
            class="bb-sw"
            style={`background: ${sw.color}`}
            aria-label={sw.label}
            title={sw.label}
            onclick={() => {
              closePopups();
              opts.onApply(sw.color);
            }}
          ></button>
        ))}
      </div>
      {hexField(opts.hexLabel, opts.onApply)}
    </div>
  );
}
