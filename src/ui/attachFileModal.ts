import { App, Modal, Setting } from "obsidian";

export interface AttachFileModalOptions {
  filename: string;
  sizeLabel: string;
  /** Store a copy inside the vault and link it internally. */
  onCopy: () => void;
  /** Link the file at its absolute path (data-mode="external"). */
  onExternal: () => void;
  /** Dialog closed without a choice (Esc / click outside) — restore the chip. */
  onDismiss?: () => void;
}

/**
 * Choice dialog for attaching a file that lives outside the vault.
 *
 * Both options state their trade-off: a copy is portable (it travels and
 * syncs with the vault) but duplicates the file; an external link references
 * the original but is not portable — it breaks if the file moves and never
 * syncs with the vault. Closing without a choice attaches nothing.
 */
export class AttachFileModal extends Modal {
  private readonly options: AttachFileModalOptions;
  private chosen = false;

  constructor(app: App, options: AttachFileModalOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    this.modalEl.addClass("inscriptum-attach-file-modal");
    this.titleEl.setText("Attach file");

    this.contentEl.createEl("p", {
      text: `“${this.options.filename}” (${this.options.sizeLabel}) is outside the vault. How should it be attached?`,
    });

    const copy = new Setting(this.contentEl).addButton((btn) =>
      btn.setButtonText("Copy to vault").onClick(() => {
        this.chosen = true;
        this.options.onCopy();
        this.close();
      }),
    );
    copy.setClass("inscriptum-attach-file-setting");

    const external = new Setting(this.contentEl).addButton((btn) =>
      btn.setButtonText("External link").setCta().onClick(() => {
        this.chosen = true;
        this.options.onExternal();
        this.close();
      }),
    );
    external.setClass("inscriptum-attach-file-setting");

    this.contentEl.createEl("p", {
      cls: "inscriptum-attach-file-hint",
      text: "Copy to vault stores a duplicate next to the note — it travels and syncs with the vault. External link references the file at its absolute path — it is not portable: it breaks if the file moves and does not sync with the vault.",
    });
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.chosen) this.options.onDismiss?.();
  }
}
