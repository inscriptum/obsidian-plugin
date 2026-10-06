import { describe, it, expect, vi } from "vitest";
import {
  createKeyboardTracking,
  keyboardViewportHeight,
} from "./keyboardTracking";

describe("keyboardViewportHeight", () => {
  it("measures the keyboard as innerHeight minus the visual viewport", () => {
    expect(keyboardViewportHeight(844, 400, 0)).toBe(444);
    expect(keyboardViewportHeight(844, 844, 0)).toBe(0);
    expect(keyboardViewportHeight(844, 700, 20)).toBe(124);
  });
});

describe("createKeyboardTracking", () => {
  function viewport(height: number, offsetTop = 0): void {
    const vv = window.visualViewport as {
      height: number;
      offsetTop: number;
    };
    vv.height = height;
    vv.offsetTop = offsetTop;
  }

  function withVisualViewport(): void {
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: {
        height: 844,
        offsetTop: 0,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
  }

  it("viewport fallback: toggles is-keyboard-open past the 120px threshold and reserves the height", () => {
    withVisualViewport();
    const target = document.createElement("div");
    const tracking = createKeyboardTracking(target);

    viewport(844);
    window.dispatchEvent(new Event("resize"));
    expect(target.classList.contains("is-keyboard-open")).toBe(false);
    expect(target.style.getPropertyValue("--keyboard-offset")).toBe("");

    viewport(600);
    window.dispatchEvent(new Event("resize"));
    expect(target.classList.contains("is-keyboard-open")).toBe(true);
    expect(target.style.getPropertyValue("--keyboard-offset")).toBe(
      `${window.innerHeight - 600}px`,
    );

    // Small viewport dips are browser chrome, not a keyboard.
    viewport(760);
    window.dispatchEvent(new Event("resize"));
    expect(target.classList.contains("is-keyboard-open")).toBe(false);

    tracking.dispose();
    expect(target.classList.contains("is-keyboard-open")).toBe(false);
    expect(target.style.getPropertyValue("--keyboard-offset")).toBe("");
  });

  it("capacitor path: keyboard events drive the state, no height is reserved", async () => {
    const listeners = new Map<string, (info: { keyboardHeight?: number }) => void>();
    const remove = vi.fn();
    (window as unknown as { Capacitor?: unknown }).Capacitor = {
      Plugins: {
        Keyboard: {
          addListener: vi.fn(
            (event: string, listener: (info: { keyboardHeight?: number }) => void) => {
              listeners.set(event, listener);
              return Promise.resolve({ remove });
            },
          ),
        },
      },
    };
    const target = document.createElement("div");
    const log = vi.fn();
    const tracking = createKeyboardTracking(target, log);

    expect(log).toHaveBeenCalledWith("keyboard path: capacitor");
    await Promise.resolve(); // let addListener promises settle
    expect(listeners.size).toBe(4);

    listeners.get("keyboardDidShow")?.({ keyboardHeight: 300 });
    expect(target.classList.contains("is-keyboard-open")).toBe(true);
    // The OS resized the view — nothing is reserved.
    expect(target.style.getPropertyValue("--keyboard-offset")).toBe("");

    listeners.get("keyboardDidHide")?.({});
    expect(target.classList.contains("is-keyboard-open")).toBe(false);

    tracking.dispose();
    expect(remove).toHaveBeenCalledTimes(4);
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  });
});
