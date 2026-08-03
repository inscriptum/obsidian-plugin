import { App, Modal, Setting, TextComponent } from 'obsidian';

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;

export class NewNoteModal extends Modal {
  private resolve: (name: string | null) => void;
  private resolved = false;
  private input: TextComponent | null = null;

  constructor(app: App, resolve: (name: string | null) => void) {
    super(app);
    this.resolve = resolve;
  }

  onOpen(): void {
    this.titleEl.setText('New Note');

    new Setting(this.contentEl).setName('Note name').addText((text) => {
      this.input = text;
      text.setPlaceholder('Untitled');
      text.inputEl.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.submit();
        }
      });
    });

    new Setting(this.contentEl).addButton((btn) =>
      btn
        .setButtonText('Create')
        .setCta()
        .onClick(() => this.submit()),
    );

    setTimeout(() => this.input?.inputEl.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolve(null);
    }
  }

  private submit(): void {
    if (!this.input) {
      return;
    }
    const raw = this.input.getValue().trim() || 'Untitled';
    const name = raw.replace(INVALID_FILENAME_CHARS, '-');

    this.resolved = true;
    this.resolve(name);
    this.close();
  }
}
