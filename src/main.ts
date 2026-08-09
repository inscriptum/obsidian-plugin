import './styles/editor.css';
import { Plugin, WorkspaceLeaf, Notice } from 'obsidian';
import { NoteView, NOTE_VIEW_TYPE } from './NoteView';
import { createEmptyNote } from './storage/noteStorage';
import { NewNoteModal } from './ui/NewNoteModal';
import type { JSONContent } from './texto/core/@types';

export default class NotesPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerExtensions(['note'], NOTE_VIEW_TYPE);

    this.registerView(
      NOTE_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new NoteView(leaf),
    );

    this.addRibbonIcon('pencil', 'New Note', () => {
      this.createNewNote();
    });

    this.addCommand({
      id: 'create-new-note',
      name: 'New Note',
      callback: () => {
        this.createNewNote();
      },
    });
  }

  private createNewNote(): void {
    new NewNoteModal(this.app, async (name) => {
      if (!name) return;

      const path = `${name}.note`;

      try {
        const initialContent = JSON.stringify(createNoteWithTitle(name), null, 2);
        const file = await this.app.vault.create(path, initialContent);
        await this.app.workspace.getLeaf('tab').openFile(file);
      } catch (err: any) {
        new Notice(`Failed to create note: ${err.message}`);
        console.error('Failed to create note:', err);
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
  const title = doc.content?.find((node) => node.type === 'noteTitle');
  if (title) {
    title.content = [{ type: 'text', text: name }];
  }
  return doc;
}
