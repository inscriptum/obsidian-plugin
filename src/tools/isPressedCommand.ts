/**
 * Physical (layout-independent) matching of keyboard shortcuts.
 *
 * This is an adaptation of prosemirror-keymap: both sides of the comparison — a shortcut
 * name like "Mod-b" and a keyboard event — are normalized into the same
 * canonical string ("Meta-b" on macOS, "Ctrl-b" elsewhere) and compared.
 * The event side derives its Latin key from the physical `event.code`
 * (`KeyB` → "b"), so Cyrillic (etc.) `event.key` values on non-Latin
 * layouts still match.
 *
 * - `matchPressedCommand` returns the matched name (needed to forward it to
 *   `editor.commands.keyboardShortcut`), not just a boolean.
 * - Unrecognized modifiers yield `null` instead of throwing: command hotkeys
 *   are scanned from the whole Obsidian registry and must never crash it.
 * - `Digit*` codes resolve to their digit so headings/lists shortcuts work
 *   when Alt produces a dead key or a symbol on some layouts.
 * - Names whose base is not a single character ("Enter", "Backspace", ...)
 *   are excluded from physical matching: their `event.key` is
 *   layout-independent anyway and ProseMirror's keymap handles them.
 *
 * Why interception layers exist here: Obsidian's own
 * command hotkeys match by `event.key` and consume Cmd/Ctrl+letter combos
 * before they reach the editor DOM. See main.ts (command patching) and
 * NoteView.handleEditorShortcut (routing).
 */

import { Plugin } from "prosemirror-state";

import { isiOS, isMacOS } from "../texto/core/utilities";

/** Canonical modifier order used on both sides of every comparison. */
const MOD_ORDER = ["Alt", "Ctrl", "Meta", "Shift"] as const;

/**
 * Normalize a shortcut name ("Mod-b",
 * "Shift-Mod-z", "CommandOrControl-k") into a canonical physical name
 * ("Meta-b" on macOS/iOS, "Ctrl-b" otherwise) or null when the name cannot
 * be matched physically (unknown modifier, non-character base like "Enter").
 * The result is lowercase, so "Mod-B" and "Mod-b" are equal.
 */
export function physicalName(name: string): string | null {
  const parts = name.split(/-(?!$)/);
  const base = parts[parts.length - 1] ?? "";
  // The keymap uses "Space" as an alias for the " " key character.
  const key = base === "Space" ? " " : base.toLowerCase();
  if (key.length !== 1) return null;

  const flags: Record<(typeof MOD_ORDER)[number], boolean> = {
    Alt: false,
    Ctrl: false,
    Meta: false,
    Shift: false,
  };
  for (const mod of parts.slice(0, -1)) {
    if (/^(cmd|meta|m)$/i.test(mod)) {
      flags.Meta = true;
    } else if (/^(c|ctrl|control)$/i.test(mod)) {
      flags.Ctrl = true;
    } else if (/^a(lt)?$/i.test(mod)) {
      flags.Alt = true;
    } else if (/^s(hift)?$/i.test(mod)) {
      flags.Shift = true;
    } else if (/^(mod|commandorcontrol)$/i.test(mod)) {
      if (isiOS() || isMacOS()) flags.Meta = true;
      else flags.Ctrl = true;
    } else {
      return null; // unrecognized modifier — don't guess
    }
  }

  // Prefix in reverse so the canonical order is Alt-Ctrl-Meta-Shift.
  let result = key;
  for (const mod of [...MOD_ORDER].reverse()) {
    if (flags[mod]) result = `${mod}-${result}`;
  }
  return result.toLowerCase();
}

/** Canonical name of a keyboard event, e.g. Cmd+Shift+B → "Meta-Shift-b". */
export function physicalEventName(event: KeyboardEvent): string | null {
  // Latin key from the physical key position; layout-transformed `event.key`
  // values are only a fallback for codes we don't map (digits are stable).
  const codeKey = event.code.startsWith("Key")
    ? event.code.at(3)
    : event.code.startsWith("Digit")
      ? event.code.at(5)
      : event.key;
  const key = codeKey?.toLowerCase();
  if (key == null || key.length !== 1) return null;

  // Append in reverse so the canonical order is Alt-Ctrl-Meta-Shift.
  let result = key;
  if (event.shiftKey) result = `Shift-${result}`;
  if (event.metaKey) result = `Meta-${result}`;
  if (event.ctrlKey) result = `Ctrl-${result}`;
  if (event.altKey) result = `Alt-${result}`;
  return result.toLowerCase();
}

/**
 * Find the shortcut from `commands` pressed in this event, or null.
 * Modifiers must match exactly so e.g. Cmd+Shift+B resolves to
 * "Mod-Shift-b" (blockquote) and never plain "Mod-b" (bold).
 */
export function matchPressedCommand(
  event: KeyboardEvent,
  commands: Iterable<string>,
): string | null {
  const eventName = physicalEventName(event);
  if (eventName == null) return null;
  for (const command of commands) {
    if (physicalName(command) === eventName) return command;
  }
  return null;
}

/** Boolean convenience wrapper around {@link matchPressedCommand}. */
export function isPressedCommand(
  event: KeyboardEvent,
  commands: Iterable<string>,
): boolean {
  return matchPressedCommand(event, commands) != null;
}

/** Symbol stored on an event to mark it as forwarded by us. */
const FORWARDED_SHORTCUT = "__inscriptumForwardedShortcut";

export type ForwardableKeyboardEvent = KeyboardEvent & {
  [FORWARDED_SHORTCUT]?: boolean;
};

/** Mark an event as forwarded by us so interception layers skip it
 *  (forwarded events re-bubble through document-level listeners). */
export function markForwardedShortcut(event: KeyboardEvent): void {
  (event as ForwardableKeyboardEvent)[FORWARDED_SHORTCUT] = true;
}

export function isForwardedShortcut(event: KeyboardEvent): boolean {
  return Boolean((event as ForwardableKeyboardEvent)[FORWARDED_SHORTCUT]);
}

/** Physical event.code → legacy keyCode, mirroring the w3c-keyname tables
 *  prosemirror-keymap relies on (`base`/`shift`). Synthetic events carry
 *  keyCode 0, which breaks the keymap's keyCode fallback resolution, so we
 *  restore it for re-dispatched shortcuts. */
const KEY_CODES: Record<string, number> = {
  " ": 32,
  "-": 189,
  "=": 187,
  ",": 188,
  ".": 190,
  "/": 191,
  ";": 186,
  "'": 222,
  "[": 219,
  "]": 221,
  "\\": 220,
  "`": 192,
};
for (let i = 0; i < 26; i += 1) KEY_CODES[String.fromCharCode(97 + i)] = 65 + i;
for (let i = 0; i < 10; i += 1) KEY_CODES[String(i)] = 48 + i;

/** Build a synthetic keydown event for a shortcut name, e.g. "Mod-b" →
 *  keydown with key "b", code "KeyB", keyCode 66, metaKey. Used to route a
 *  hotkey combo that reached us without a real DOM event (Obsidian command
 *  callback) and to re-dispatch a resolved shortcut into the editor DOM so
 *  ProseMirror's own keymap applies it natively. */
export function nameToKeyboardEvent(name: string): KeyboardEvent | null {
  const physical = physicalName(name);
  if (physical == null) return null;

  // The base key must come from the original name: splitting the physical
  // name would break for keys that contain a dash ("Mod-Alt--").
  const base = name.split(/-(?!$)/).pop() ?? "";
  const key = base === "Space" ? " " : base.toLowerCase();
  if (key.length !== 1) return null;

  const shift = physical.includes("shift-");
  const keyCode = KEY_CODES[key];
  if (keyCode == null) return null;

  return new KeyboardEvent("keydown", {
    key: shift ? key.toUpperCase() : key,
    code: /^[a-z]$/.test(key)
      ? `Key${key.toUpperCase()}`
      : /^\d$/.test(key)
        ? `Digit${key}`
        : "",
    keyCode,
    altKey: physical.includes("alt-"),
    ctrlKey: physical.includes("ctrl-"),
    metaKey: physical.includes("meta-"),
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
}

/** Duck-typed subset of an Obsidian command relevant for hotkey collisions. */
export interface CommandLike {
  id?: string;
  hotkeys?: Array<{ modifiers?: string[]; key?: string }>;
  checkCallback?: (checking: boolean) => boolean;
  callback?: () => void;
  editorCallback?: (editor: unknown, view: unknown) => void;
}

/**
 * Find Obsidian commands whose hotkeys physically collide with an owned
 * shortcut (exact canonical-name equality). Colliding commands swallow
 * Cmd/Ctrl+letter combos before they reach the DOM, so the host must patch
 * them and route the combos to the editor while a NoteView is active.
 * Returns command id → the owned shortcut names that collided.
 */
export function findCommandsCollidingWith(
  commands: Record<string, CommandLike>,
  owned: Iterable<string>,
): Map<string, string[]> {
  const ownedByName = new Map<string, string>();
  for (const name of owned) {
    const physical = physicalName(name);
    if (physical != null) ownedByName.set(physical, name);
  }

  const collisions = new Map<string, string[]>();
  for (const [id, command] of Object.entries(commands)) {
    if (!command.hotkeys?.length) continue;

    if (!command.checkCallback && !command.callback && !command.editorCallback)
      continue;

    const matched = new Set<string>();
    for (const binding of command.hotkeys) {
      if (!binding.key) continue;
      const physical = physicalName(
        [...(binding.modifiers ?? []), binding.key].join("-"),
      );
      const name = physical != null ? ownedByName.get(physical) : undefined;
      if (name != null) matched.add(name);
    }
    if (matched.size) collisions.set(id, [...matched]);
  }
  return collisions;
}

/**
 * ProseMirror-level catch for layout-transformed events: non-Latin layouts
 * report Cyrillic (etc.) `event.key` for Ctrl/Cmd+letter, which neither
 * Obsidian hotkeys nor the PM keymap can match. This plugin runs after the
 * keymap (registered as a direct plugin) and resolves the event by its
 * physical key code instead.
 */
export function createPhysicalShortcutPlugin(options: {
  getCommands: () => Iterable<string>;
  handleShortcut: (event: KeyboardEvent) => boolean;
}): Plugin {
  return new Plugin({
    props: {
      handleKeyDown: (_view, event) => {
        if (!(event.metaKey || event.ctrlKey)) return false;
        if (isForwardedShortcut(event)) return false;
        if (!isPressedCommand(event, options.getCommands())) return false;
        return options.handleShortcut(event);
      },
    },
  });
}
