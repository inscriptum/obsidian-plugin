import "./styles/editor.css";
import { Notice, normalizePath, Plugin, WorkspaceLeaf } from "obsidian";
import { NoteView, NOTE_VIEW_TYPE } from "./NoteView";
import { installIconSprite } from "./components/icons/iconSprite";
import { createEmptyNote } from "./storage/noteStorage";
import { NewNoteModal } from "./ui/NewNoteModal";
import type { JSONContent } from "./texto/core/@types";

export default class NotesPlugin extends Plugin {
  async onload(): Promise<void> {
    installIconSprite();

    this.registerExtensions(["note"], NOTE_VIEW_TYPE);

    this.registerView(
      NOTE_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new NoteView(leaf),
    );

    this.addRibbonIcon("notebook-pen", "New note", () => {
      this.createNewNote();
    });

    this.addCommand({
      id: "create-new-note",
      name: "New note",
      callback: () => {
        this.createNewNote();
      },
    });
  }

  private createNewNote() {
    new NewNoteModal(this.app, async (name) => {
      if (!name) return;

      const newFilePath = `${name}.note`;

      try {
        const activeFilePath = this.app.workspace.getActiveFile()?.path ?? "";
        const parent = this.app.fileManager.getNewFileParent(
          activeFilePath,
          newFilePath,
        );
        const path = normalizePath(
          parent.path ? `${parent.path}/${newFilePath}` : newFilePath,
        );
        const initialContent = JSON.stringify(
          createNoteWithTitle(name),
          null,
          2,
        );
        const file = await this.app.vault.create(path, initialContent);
        await this.app.workspace.getLeaf("tab").openFile(file);
      } catch (error) {
        new Notice(
          `Failed to create note: ${error instanceof Error ? error.message : String(error)}`,
        );
        console.error("Failed to create note:", error);
      }
    }).open();
  }
}

/**
 * Creates a new note document with a filled title (noteTitle),
 * so the file name and the title inside the note stay in sync.
 */
function createNoteWithTitle(name: string): JSONContent {
  const doc = createEmptyNote();
  const title = doc.content?.find((node) => node.type === "noteTitle");
  if (title) {
    title.content = [{ type: "text", text: name }];
  }
  return doc;
}
