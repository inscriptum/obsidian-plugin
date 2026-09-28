import { App, Modal, Setting } from "obsidian";

export interface ConfirmModalOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
}

/** Yes/No confirmation dialog. Escape closes as cancel. */
export class ConfirmModal extends Modal {
  private options: ConfirmModalOptions;

  constructor(app: App, options: ConfirmModalOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    this.titleEl.setText(this.options.title ?? "Are you sure?");
    this.contentEl.createEl("p", { text: this.options.message });

    const buttons = new Setting(this.contentEl);
    buttons.addButton((btn) =>
      btn
        .setButtonText(this.options.cancelText ?? "Cancel")
        .onClick(() => this.close()),
    );
    buttons.addButton((btn) =>
      btn
        .setButtonText(this.options.confirmText ?? "OK")
        .setCta()
        .onClick(() => {
          this.close();
          this.options.onConfirm();
        }),
    );
  }
}
