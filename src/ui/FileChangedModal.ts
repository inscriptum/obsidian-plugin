import { App, Modal, Setting } from "obsidian";

export interface FileChangedModalOptions {
  /** Keep the editor content and overwrite the file on disk. */
  onKeepLocal: () => void;
  /** Discard editor changes and load the file from disk. */
  onTakeDisk: () => void;
  /** Called when the modal closes for any reason (choice or Esc). */
  onClose?: () => void;
}

/**
 * Conflict dialog shown when the note file was changed externally
 * (e.g. git sync) while the editor holds unsaved changes.
 *
 * Neither option is silent: keeping local changes overwrites the disk
 * version, taking the disk version discards the local edits — the dialog
 * states this explicitly. Closing without a choice (Esc) keeps the status
 * quo: local edits stay in the editor, the file stays untouched.
 */
export class FileChangedModal extends Modal {
  private readonly options: FileChangedModalOptions;
  private chosen = false;

  constructor(app: App, options: FileChangedModalOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    this.modalEl.addClass("inscriptum-file-changed-modal");
    this.titleEl.setText("Note changed on disk");

    this.contentEl.createEl("p", {
      text: "This note was modified outside the editor (for example by a sync) while you have unsaved changes.",
    });

    const keep = new Setting(this.contentEl).addButton((btn) =>
      btn
        .setButtonText("Keep my changes")
        .setCta()
        .onClick(() => {
          this.chosen = true;
          this.options.onKeepLocal();
          this.close();
        }),
    );
    keep.setClass("inscriptum-file-changed-setting");

    const take = new Setting(this.contentEl).addButton((btn) =>
      btn.setButtonText("Load from disk").onClick(() => {
        this.chosen = true;
        this.options.onTakeDisk();
        this.close();
      }),
    );
    take.setClass("inscriptum-file-changed-setting");

    this.contentEl.createEl("p", {
      cls: "inscriptum-file-changed-hint",
      text: "Keep my changes overwrites the file on disk. Load from disk discards your unsaved edits.",
    });
  }

  onClose(): void {
    this.contentEl.empty();
    this.options.onClose?.();
  }
}
