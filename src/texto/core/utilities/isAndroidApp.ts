import { Platform } from "obsidian";

export function isAndroidApp(): boolean {
  return Platform.isAndroidApp;
}
