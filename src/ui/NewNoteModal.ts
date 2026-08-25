import { App, Modal, Setting, TextComponent, type TFolder } from "obsidian";

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;

export class NewNoteModal extends Modal {
  private resolve: (
    result: { name: string; folderPath: string } | null,
  ) => Promise<void>;
  private resolved = false;
  private input: TextComponent | null = null;
  private folderPath: string;
  private folders: TFolder[];

  constructor(
    app: App,
    folders: TFolder[],
    defaultFolderPath: string,
    resolve: (
      result: { name: string; folderPath: string } | null,
    ) => Promise<void>,
  ) {
    super(app);
    this.resolve = resolve;
    this.folders = folders;
    this.folderPath = defaultFolderPath === "/" ? "" : defaultFolderPath;
  }

  onOpen(): void {
    this.modalEl.addClass("inscriptum-new-note-modal");
    this.titleEl.setText("New inscriptum");

    const nameSetting = new Setting(this.contentEl)
      .setName("Note name")
      .setClass("inscriptum-new-note-setting");
    nameSetting.addText((text) => {
      this.input = text;
      text.setPlaceholder("Untitled");
      text.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.submit();
        }
      });
    });

    const folderSetting = new Setting(this.contentEl)
      .setName("Folder")
      .setClass("inscriptum-new-note-setting");
    folderSetting.addDropdown((dropdown) => {
      const folders = [...this.folders].sort((a, b) =>
        a.path.localeCompare(b.path),
      );
      for (const folder of folders) {
        dropdown.addOption(folder.path, folder.path || "/");
      }
      dropdown.setValue(this.folderPath);
      dropdown.onChange((value) => {
        this.folderPath = value;
      });
    });

    new Setting(this.contentEl).addButton((btn) =>
      btn
        .setButtonText("Create")
        .setCta()
        .onClick(() => this.submit()),
    );

    window.setTimeout(() => this.input?.inputEl.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolve(null).catch((e) => console.error(e));
    }
  }

  private submit(): void {
    if (!this.input) {
      return;
    }
    const raw = this.input.getValue().trim() || "Untitled";
    const name = raw.replace(INVALID_FILENAME_CHARS, "-");

    this.resolved = true;
    this.resolve({ name, folderPath: this.folderPath }).catch((e) =>
      console.error(e),
    );
    this.close();
  }
}
