import type { TFolder } from 'obsidian';
import { vi } from 'vitest';

export class Vault {
  read = vi.fn();
  modify = vi.fn();
  create = vi.fn();
  delete = vi.fn();
  rename = vi.fn();
  getAbstractFileByPath = vi.fn();
}

export class TFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
  stat: {ctime: number; mtime: number; size: number};
  vault: Vault | null;
  parent: TFolder | null;

  constructor(path: string) {
    this.path = path;
    const parts = path.split('/');
    const filename = parts[parts.length - 1];
    const dotIndex = filename.lastIndexOf('.');
    this.name = filename;
    this.basename = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
    this.extension = dotIndex > 0 ? filename.slice(dotIndex + 1) : '';
    this.stat = { ctime: 0, mtime: 0, size: 0 };
    this.vault = null;
    this.parent = null;
  }
}

export class Notice {
  constructor(_message: string) {}
}

export const Platform = {
  isDesktop: true,
  isMobile: false,
  isMacOS: false,
  isIosApp: false,
  isAndroidApp: false,
  isWin: false,
  isLinux: false,
};

export class Plugin {
  app: unknown;
  loadData(): Promise<unknown> {
    return Promise.resolve({});
  }
  saveData(_data: unknown): Promise<void> {
    return Promise.resolve();
  }
}

export abstract class ItemView {
  abstract getViewType(): string;
  abstract getDisplayText(): string;
  abstract getIcon(): string;
  app: unknown;
  contentEl: HTMLElement;
  constructor(_leaf: unknown) {
    this.contentEl = createDiv();
  }
  abstract onOpen(): Promise<void>;
  abstract onClose(): Promise<void>;
}
