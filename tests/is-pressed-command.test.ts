import {describe, expect, it, vi} from "vitest";
import {Platform} from "obsidian";
import {
  createPhysicalShortcutPlugin,
  findCommandsCollidingWith,
  isForwardedShortcut,
  isPressedCommand,
  markForwardedShortcut,
  matchPressedCommand,
  nameToKeyboardEvent,
  physicalEventName,
  physicalName,
} from "../src/tools/isPressedCommand";

function evt(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    code: "",
    key: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("physicalName", () => {
  it("expands Mod to Meta on macOS and Ctrl elsewhere", () => {
    Platform.isMacOS = true;
    expect(physicalName("Mod-b")).toBe("meta-b");
    Platform.isMacOS = false;
    expect(physicalName("Mod-b")).toBe("ctrl-b");
  });

  it("is case-insensitive on the base key", () => {
    Platform.isMacOS = true;
    expect(physicalName("Mod-B")).toBe(physicalName("Mod-b"));
  });

  it("keeps exact modifiers in canonical order", () => {
    Platform.isMacOS = true;
    expect(physicalName("Mod-Shift-b")).toBe("meta-shift-b");
    expect(physicalName("Shift-Mod-b")).toBe("meta-shift-b");
    expect(physicalName("Mod-Alt-1")).toBe("alt-meta-1");
  });

  it("expands CommandOrControl like Obsidian hotkeys", () => {
    Platform.isMacOS = true;
    expect(physicalName("CommandOrControl-k")).toBe("meta-k");
    Platform.isMacOS = false;
    expect(physicalName("CommandOrControl-k")).toBe("ctrl-k");
  });

  it("maps Space to the space character", () => {
    Platform.isMacOS = true;
    expect(physicalName("Mod-Space")).toBe("meta- ");
  });

  it("returns null for non-character keys and unknown modifiers", () => {
    Platform.isMacOS = false;
    expect(physicalName("Enter")).toBeNull();
    expect(physicalName("Mod-Enter")).toBeNull();
    expect(physicalName("Shift-Backspace")).toBeNull();
    expect(physicalName("Mod-Foo-b")).toBeNull();
  });
});

describe("physicalEventName", () => {
  it("derives the Latin key from the physical code (Cyrillic layout)", () => {
    Platform.isMacOS = true;
    // Russian layout: Cmd+B reports key="и"
    expect(physicalEventName(evt({code: "KeyB", key: "и", metaKey: true}))).toBe("meta-b");
    Platform.isMacOS = false;
    expect(physicalEventName(evt({code: "KeyB", key: "и", ctrlKey: true, shiftKey: true}))).toBe(
      "ctrl-shift-b",
    );
  });

  it("derives digits from Digit codes", () => {
    Platform.isMacOS = true;
    expect(physicalEventName(evt({code: "Digit8", key: "8", shiftKey: true}))).toBe("shift-8");
    // macOS Alt+8 reports a symbol as key; the code wins
    expect(physicalEventName(evt({code: "Digit1", key: "¡", metaKey: true, altKey: true}))).toBe(
      "alt-meta-1",
    );
  });

  it("returns null without a single-character key", () => {
    expect(physicalEventName(evt({code: "Enter", key: "Enter"}))).toBeNull();
    expect(physicalEventName(evt({code: "", key: "Escape"}))).toBeNull();
    expect(physicalEventName(evt({code: "", key: ""}))).toBeNull();
  });
});

describe("matchPressedCommand", () => {
  const shortcuts = ["Mod-b", "Mod-i", "Mod-Shift-b", "Shift-Mod-z", "Mod-y"];

  it("matches a Cyrillic key event by physical code (Cmd on mac)", () => {
    Platform.isMacOS = true;
    expect(matchPressedCommand(evt({code: "KeyB", key: "и", metaKey: true}), shortcuts)).toBe("Mod-b");
    expect(isPressedCommand(evt({code: "KeyB", key: "и", metaKey: true}), shortcuts)).toBe(true);
  });

  it("matches a Cyrillic key event by physical code (Ctrl on windows)", () => {
    Platform.isMacOS = false;
    expect(matchPressedCommand(evt({code: "KeyB", key: "и", ctrlKey: true}), shortcuts)).toBe("Mod-b");
  });

  it("requires shift to match shift variants", () => {
    Platform.isMacOS = true;
    const withShift = evt({code: "KeyB", metaKey: true, shiftKey: true});
    expect(matchPressedCommand(withShift, shortcuts)).toBe("Mod-Shift-b");
    // Cmd+Shift+B must not toggle bold
    expect(matchPressedCommand(withShift, ["Mod-b", "Mod-Shift-b"])).toBe("Mod-Shift-b");
    expect(matchPressedCommand(withShift, ["Mod-b"])).toBeNull();
  });

  it("matches digits physically", () => {
    Platform.isMacOS = false;
    expect(matchPressedCommand(evt({code: "Digit8", key: "8", ctrlKey: true, shiftKey: true}), ["Mod-Shift-8"])).toBe(
      "Mod-Shift-8",
    );
  });

  it("does not match events without modifiers or unregistered keys", () => {
    Platform.isMacOS = true;
    expect(matchPressedCommand(evt({code: "KeyB", key: "b"}), shortcuts)).toBeNull();
    expect(matchPressedCommand(evt({code: "KeyC", key: "c", metaKey: true}), shortcuts)).toBeNull();
  });

  it("skips non-character shortcuts (they stay with the PM keymap)", () => {
    Platform.isMacOS = false;
    expect(matchPressedCommand(evt({code: "Enter", key: "Enter", ctrlKey: true}), ["Mod-Enter"])).toBeNull();
  });
});

describe("nameToKeyboardEvent", () => {
  it("round-trips through matchPressedCommand", () => {
    Platform.isMacOS = true;
    for (const name of ["Mod-b", "Mod-Shift-b", "Mod-Alt-1", "Mod-f"]) {
      const event = nameToKeyboardEvent(name);
      expect(event, name).not.toBeNull();
      expect(matchPressedCommand(event as KeyboardEvent, [name])).toBe(name);
    }
    const event = nameToKeyboardEvent("Mod-b") as KeyboardEvent;
    expect(event.code).toBe("KeyB");
    expect(event.metaKey).toBe(true);
    expect(event.key).toBe("b");
  });

  it("carries a real keyCode so keymap fallback resolution works", () => {
    Platform.isMacOS = true;
    expect(nameToKeyboardEvent("Mod-b")?.keyCode).toBe(66);
    expect(nameToKeyboardEvent("Mod-Alt-1")?.keyCode).toBe(49);
    expect(nameToKeyboardEvent("Mod-Alt--")?.keyCode).toBe(189);
    const shifted = nameToKeyboardEvent("Mod-Shift-b") as KeyboardEvent;
    expect(shifted.keyCode).toBe(66);
    expect(shifted.key).toBe("B");
    expect(shifted.shiftKey).toBe(true);
  });

  it("returns null for non-physical names", () => {
    expect(nameToKeyboardEvent("Mod-Enter")).toBeNull();
    expect(nameToKeyboardEvent("Foo-b")).toBeNull();
  });
});

describe("forwarded shortcut markers", () => {
  it("round-trips", () => {
    const event = evt({code: "KeyK", metaKey: true});
    expect(isForwardedShortcut(event)).toBe(false);
    markForwardedShortcut(event);
    expect(isForwardedShortcut(event)).toBe(true);
  });
});

describe("findCommandsCollidingWith", () => {
  function cmd(hotkeys: Array<{modifiers?: string[]; key?: string}>, kind: "check" | "callback" = "check") {
    const c: Record<string, unknown> = {hotkeys};
    if (kind === "check") c.checkCallback = () => false;
    else c.callback = () => {};
    return c;
  }

  it("finds commands whose hotkeys physically collide with owned shortcuts", () => {
    Platform.isMacOS = true;
    const owned = ["Mod-b", "Mod-Shift-b", "Mod-f"];
    const commands = {
      "editor:toggle-bold": cmd([{modifiers: ["Mod"], key: "B"}]),
      "editor:toggle-bold-upper": cmd([{modifiers: ["Mod", "Shift"], key: "B"}]),
      "search:find": cmd([{modifiers: ["Mod"], key: "F"}]),
      "command-palette:open": cmd([{modifiers: ["Mod"], key: "P"}]),
      "no-hotkeys": cmd([]),
      "unmatched": cmd([{modifiers: ["Mod"], key: "Q"}]),
      "no-callback": {hotkeys: [{modifiers: ["Mod"], key: "B"}]},
    };
    const collisions = findCommandsCollidingWith(commands as never, owned);
    expect([...collisions.keys()].sort()).toEqual([
      "editor:toggle-bold",
      "editor:toggle-bold-upper",
      "search:find",
    ]);
    expect(collisions.get("editor:toggle-bold")).toEqual(["Mod-b"]);
    expect(collisions.get("editor:toggle-bold-upper")).toEqual(["Mod-Shift-b"]);
  });

  it("matches platform-appropriate Mod expansion", () => {
    Platform.isMacOS = false;
    const commands = {"win-only": cmd([{modifiers: ["Ctrl"], key: "B"}])};
    // on Windows Mod expands to Ctrl: the hotkey collides
    expect(findCommandsCollidingWith(commands as never, ["Mod-b"]).size).toBe(1);
    Platform.isMacOS = true;
    // on macOS Mod expands to Meta: no collision with a Ctrl hotkey
    expect(findCommandsCollidingWith(commands as never, ["Mod-b"]).size).toBe(0);
  });

  it("supports CommandOrControl hotkeys", () => {
    const commands = {"custom": cmd([{modifiers: ["CommandOrControl"], key: "F"}])};
    expect(findCommandsCollidingWith(commands as never, ["Mod-f"]).size).toBe(1);
  });
});

describe("createPhysicalShortcutPlugin", () => {
  function makePlugin(handler: (event: KeyboardEvent) => boolean) {
    return createPhysicalShortcutPlugin({
      getCommands: () => ["Mod-b"],
      handleShortcut: handler,
    });
  }

  it("matches layout-transformed events by physical code", () => {
    Platform.isMacOS = true;
    const handle = vi.fn(() => true);
    const plugin = makePlugin(handle);
    const result = plugin.props.handleKeyDown?.(
      {} as never,
      evt({key: "и", code: "KeyB", metaKey: true}) as KeyboardEvent,
    );
    expect(result).toBe(true);
    expect(handle).toHaveBeenCalled();
  });

  it("ignores events without Cmd/Ctrl and forwarded events", () => {
    Platform.isMacOS = true;
    const handle = vi.fn(() => true);
    const plugin = makePlugin(handle);
    expect(plugin.props.handleKeyDown?.({} as never, evt({key: "b", code: "KeyB"}))).toBe(false);
    const forwarded = evt({key: "k", code: "KeyK", metaKey: true});
    markForwardedShortcut(forwarded);
    expect(plugin.props.handleKeyDown?.({} as never, forwarded)).toBe(false);
    expect(handle).not.toHaveBeenCalled();
  });

  it("passes unmatched combos through", () => {
    Platform.isMacOS = true;
    const handle = vi.fn(() => true);
    const plugin = makePlugin(handle);
    expect(plugin.props.handleKeyDown?.({} as never, evt({key: "c", code: "KeyC", metaKey: true}))).toBe(false);
    expect(handle).not.toHaveBeenCalled();
  });
});
