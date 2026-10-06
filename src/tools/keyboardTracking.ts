/**
 * Soft-keyboard tracking for mobile views (phones).
 *
 * Toggles `is-keyboard-open` on the given element while the keyboard is up,
 * so CSS can show/hide the bottom toolbar (mobile.css). Focus is deliberately
 * not used: dismissing the keyboard does not necessarily blur a
 * contenteditable element.
 *
 * The Capacitor path is authoritative on devices (Obsidian exposes the
 * Keyboard plugin there); visualViewport is the fallback for desktop mobile
 * emulation and browsers without Capacitor — it may overlay the keyboard, so
 * only that path also reserves the keyboard height via `--keyboard-offset`.
 */

type KeyboardPlugin = {
  addListener?: (
    event: string,
    listener: (info: { keyboardHeight?: number }) => void,
  ) => Promise<{ remove: () => Promise<void> | void }>;
};

export interface KeyboardTracking {
  /** Remove every listener and clear the element's state. */
  dispose(): void;
}

/** Pure height→state mapping (unit-testable): the keyboard counts as open
 *  above 120px — smaller viewport dips are browser chrome, not a keyboard. */
export function keyboardViewportHeight(
  innerHeight: number,
  viewportHeight: number,
  offsetTop: number,
): number {
  return Math.max(0, innerHeight - viewportHeight - offsetTop);
}

export function createKeyboardTracking(
  target: HTMLElement,
  log?: (message: string) => void,
): KeyboardTracking {
  let disposed = false;
  const cleanups: Array<() => void> = [];

  const update = (height: number, reserveSpace: boolean) => {
    if (disposed) return;
    const open = height > 0;
    target.classList.toggle("is-keyboard-open", open);
    // Capacitor/Obsidian already resizes the view above the keyboard. The
    // viewport fallback may overlay it, so only that path needs padding.
    if (reserveSpace && open) {
      target.style.setProperty("--keyboard-offset", `${height}px`);
    } else {
      target.style.removeProperty("--keyboard-offset");
    }
  };

  const capacitor = (
    window as unknown as {
      Capacitor?: { Plugins?: { Keyboard?: KeyboardPlugin } };
    }
  ).Capacitor;
  const keyboard = capacitor?.Plugins?.Keyboard;
  log?.(
    `keyboard path: ${keyboard?.addListener ? "capacitor" : "visualViewport fallback"}`,
  );

  if (keyboard?.addListener) {
    update(0, false);
    for (const event of [
      "keyboardWillShow",
      "keyboardDidShow",
      "keyboardWillHide",
      "keyboardDidHide",
    ]) {
      void keyboard
        .addListener(event, (info) => {
          const height = event.endsWith("Hide")
            ? 0
            : Number(info.keyboardHeight ?? 0);
          update(Number.isFinite(height) ? height : 0, false);
        })
        .then((handle) => {
          if (disposed) void handle.remove();
          else
            cleanups.push(() => {
              void handle.remove();
            });
        })
        .catch(() => {
          /* plugin gone — the viewport fallback cannot be retrofitted here */
        });
    }
  } else {
    const updateFromViewport = () => {
      const viewport = window.visualViewport;
      if (!viewport) {
        update(0, false);
        return;
      }
      const height = keyboardViewportHeight(
        window.innerHeight,
        viewport.height,
        viewport.offsetTop,
      );
      update(height > 120 ? height : 0, true);
    };
    updateFromViewport();
    const viewport = window.visualViewport;
    if (viewport) {
      viewport.addEventListener("resize", updateFromViewport);
      viewport.addEventListener("scroll", updateFromViewport);
      cleanups.push(() => {
        viewport.removeEventListener("resize", updateFromViewport);
        viewport.removeEventListener("scroll", updateFromViewport);
      });
    }
    window.addEventListener("resize", updateFromViewport);
    cleanups.push(() => window.removeEventListener("resize", updateFromViewport));
  }

  return {
    dispose() {
      disposed = true;
      for (const fn of cleanups) fn();
      cleanups.length = 0;
      target.classList.remove("is-keyboard-open");
      target.style.removeProperty("--keyboard-offset");
    },
  };
}
