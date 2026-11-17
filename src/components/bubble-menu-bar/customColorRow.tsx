import { BORDER_COLORS, isHexColor } from "./tableMenuState";

// TRAP: native color dialogs dismiss the mobile keyboard and its toolbar.
// The coarse popup is portaled to body to escape clipping and Tippy transforms.
const BASE_COLORS = BORDER_COLORS.filter((c) => c.color != null) as Array<{
  label: string;
  color: string;
}>;

function mixHex(
  hex: string,
  target: [number, number, number],
  amount: number,
): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const parts = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c, i) =>
    Math.round(c + (target[i] - c) * amount),
  );
  return `#${parts.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

const PICKER_GRID: Array<{ color: string; label: string }> =
  BASE_COLORS.flatMap((c) => [
    { color: mixHex(c.color, WHITE, 0.45), label: `${c.label} light` },
    { color: c.color, label: c.label },
    { color: mixHex(c.color, BLACK, 0.35), label: `${c.label} dark` },
  ]);

const stopBubbling = (e: Event) => e.stopPropagation();

let closeActivePopup: (() => void) | null = null;
let activeButton: HTMLElement | null = null;
const closePopups = (): void => closeActivePopup?.();

function openPopup(button: HTMLElement, popup: HTMLElement): void {
  const row = button.parentElement;
  if (!row) return;
  const doc = button.ownerDocument;
  const win = doc.defaultView;
  if (!win) return;
  popup.classList.toggle(
    "bb-dd-popup--mobile",
    !!row.closest(".mobile-sel-bar"),
  );
  popup.setAttribute("data-ignore-swipe", "true");
  doc.body.appendChild(popup);
  popup.classList.add("show");
  activeButton = button;

  const place = () => {
    if (!button.isConnected || button.getClientRects().length === 0) {
      closePopups();
      return;
    }
    const viewport = win.visualViewport;
    const left = (viewport?.offsetLeft ?? 0) + 8;
    const top = (viewport?.offsetTop ?? 0) + 8;
    const width = (viewport?.width ?? win.innerWidth) - 16;
    const height = (viewport?.height ?? win.innerHeight) - 16;
    const maxWidth = `${Math.max(0, width)}px`;
    const maxHeight = `${Math.max(0, height)}px`;
    if (popup.style.maxWidth !== maxWidth) popup.style.maxWidth = maxWidth;
    if (popup.style.maxHeight !== maxHeight) popup.style.maxHeight = maxHeight;
    const rect = button.getBoundingClientRect();
    const x = `${Math.max(left, Math.min(rect.left, left + width - popup.offsetWidth))}px`;
    const y = `${Math.max(top, Math.min(rect.top - popup.offsetHeight - 8, top + height - popup.offsetHeight))}px`;
    if (popup.style.left !== x) popup.style.left = x;
    if (popup.style.top !== y) popup.style.top = y;
  };
  // TRAP: Tippy can move during a CSS transition without scroll/resize.
  let frame = 0;
  let isOpen = true;
  let trackUntil = 0;
  const trackAnchor = (now: number) => {
    frame = 0;
    place();
    if (isOpen && now < trackUntil)
      frame = win.requestAnimationFrame(trackAnchor);
  };
  const scheduleTracking = () => {
    if (!isOpen) return;
    trackUntil = win.performance.now() + 300;
    if (!frame) frame = win.requestAnimationFrame(trackAnchor);
  };
  const onOutside = (event: Event) => {
    if (
      event.target instanceof Node &&
      (row.contains(event.target) || popup.contains(event.target))
    )
      return;
    closePopups();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") closePopups();
  };
  const onScroll = (event: Event) => {
    if (event.target instanceof Node && popup.contains(event.target)) return;
    place();
  };
  const anchor =
    row.closest(
      ".bubble-menu-popper, .note-toolbar-host, .notepad-toolbar-host",
    ) ?? row;
  const observer = new MutationObserver(() => {
    if (!button.isConnected || button.getClientRects().length === 0)
      closePopups();
    else scheduleTracking();
  });
  const lifecycle = new MutationObserver(() => {
    if (!button.isConnected) closePopups();
  });
  closeActivePopup = () => {
    isOpen = false;
    closeActivePopup = null;
    activeButton = null;
    observer.disconnect();
    lifecycle.disconnect();
    win.cancelAnimationFrame(frame);
    anchor.removeEventListener("transitionrun", scheduleTracking);
    doc.removeEventListener("pointerdown", onOutside, true);
    doc.removeEventListener("keydown", onKey, true);
    doc.removeEventListener("scroll", onScroll, true);
    win.removeEventListener("resize", place);
    win.visualViewport?.removeEventListener("resize", place);
    win.visualViewport?.removeEventListener("scroll", place);
    popup.classList.remove("show");
    if (button.isConnected) row.appendChild(popup);
    else popup.remove();
  };
  doc.addEventListener("pointerdown", onOutside, true);
  doc.addEventListener("keydown", onKey, true);
  doc.addEventListener("scroll", onScroll, true);
  win.addEventListener("resize", place);
  win.visualViewport?.addEventListener("resize", place);
  win.visualViewport?.addEventListener("scroll", place);
  observer.observe(anchor, {
    childList: true,
    subtree: true,
    attributes: true,
  });
  for (
    let parent = anchor.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    observer.observe(parent, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
  }
  lifecycle.observe(doc.body, { childList: true, subtree: true });
  anchor.addEventListener("transitionrun", scheduleTracking);
  place();
  scheduleTracking();
}

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

  return (
    <div class="bb-dd-custom bb-dd-custom--coarse">
      <button
        class="bb-dd-open"
        style={`background: ${opts.value}`}
        aria-label="Custom color"
        data-tip="Custom color"
        onclick={(e: Event) => {
          const btn = e.currentTarget as HTMLElement;
          if (activeButton === btn) {
            closePopups();
            return;
          }
          const popup =
            btn.parentElement?.querySelector<HTMLElement>(".bb-dd-popup");
          if (!popup) return;
          const willOpen = !popup.classList.contains("show");
          closePopups();
          if (!willOpen) return;
          openPopup(btn, popup);
        }}
      ></button>
      <div
        class="bb-dd-popup"
        onpointerdown={(event: Event) => event.preventDefault()}
        onmousedown={(event: Event) => event.preventDefault()}
      >
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
