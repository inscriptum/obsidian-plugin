import { App, Modal, Setting, TextComponent, type TFolder } from "obsidian";

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;

/** What the modal should create: a plain `.note` or a `.um` notebook. */
export type NewNoteKind = "note" | "notebook";

export interface NewNoteResult {
  name: string;
  folderPath: string;
  kind: NewNoteKind;
}

export interface NewNoteModalOptions {
  title?: string;
  namePlaceholder?: string;
  /** Preset the type selector. */
  kind?: NewNoteKind;
  /** Show the Note/Notebook selector (default true). */
  chooseKind?: boolean;
}

export class NewNoteModal extends Modal {
  private resolve: (result: NewNoteResult | null) => Promise<void>;
  private resolved = false;
  private input: TextComponent | null = null;
  private folderPath: string;
  private folders: TFolder[];
  private modalTitle: string | undefined;
  private namePlaceholder: string | undefined;
  private kind: NewNoteKind;
  private chooseKind: boolean;

  constructor(
    app: App,
    folders: TFolder[],
    defaultFolderPath: string,
    resolve: (result: NewNoteResult | null) => Promise<void>,
    options?: NewNoteModalOptions,
  ) {
    super(app);
    this.resolve = resolve;
    this.folders = folders;
    this.folderPath = defaultFolderPath === "/" ? "" : defaultFolderPath;
    this.modalTitle = options?.title;
    this.namePlaceholder = options?.namePlaceholder;
    this.kind = options?.kind ?? "note";
    this.chooseKind = options?.chooseKind ?? true;
  }

  onOpen(): void {
    this.modalEl.addClass("inscriptum-new-note-modal");
    this.titleEl.setText(this.modalTitle ?? "New inscriptum");

    if (this.chooseKind) {
      const kindSetting = new Setting(this.contentEl)
        .setName("Type")
        .setClass("inscriptum-new-note-setting");
      kindSetting.addDropdown((dropdown) => {
        dropdown.addOption("note", "Note (.note)");
        dropdown.addOption("notebook", "Notebook (.um)");
        dropdown.setValue(this.kind);
        dropdown.onChange((value) => {
          this.kind = value === "notebook" ? "notebook" : "note";
        });
      });
    }
    const nameSetting = new Setting(this.contentEl)
      .setName("Note name")
      .setClass("inscriptum-new-note-setting");
    nameSetting.addText((text) => {
      this.input = text;
      text.setPlaceholder(this.namePlaceholder ?? "Untitled");
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
    this.resolve({ name, folderPath: this.folderPath, kind: this.kind }).catch(
      (e) => console.error(e),
    );
    this.close();
  }
}
