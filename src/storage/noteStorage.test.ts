import { describe, it, expect } from 'vitest';
import type { Vault as ObsidianVault } from 'obsidian';
import { Vault, TFile } from '../__mocks__/obsidian';
import { readNote, readNoteWithRaw, writeNote, createEmptyNote, parseNoteDoc, isEmptyNoteDoc, EMPTY_DOC } from './noteStorage';

describe('noteStorage', () => {
  describe('createEmptyNote', () => {
    it('returns a noteDoc with title and paragraph', () => {
      const doc = createEmptyNote();
      expect(doc.type).toBe('noteDoc');
      expect(doc.content).toHaveLength(2);
      expect(doc.content![0].type).toBe('noteTitle');
      expect(doc.content![1].type).toBe('paragraph');
    });

    it('returns a deep copy, not a reference to EMPTY_DOC', () => {
      const doc = createEmptyNote();
      doc.content![0].type = 'modified';
      expect(EMPTY_DOC.content![0].type).toBe('noteTitle');
    });
  });

  describe('readNote', () => {
    it('parses valid JSON content', async () => {
      const file = new TFile('test.note');
      const vault = new Vault();
      const content = { type: 'noteDoc', content: [] };
      vault.read.mockResolvedValue(JSON.stringify(content));

      const result = await readNote(file, vault as unknown as ObsidianVault);

      expect(result).toEqual(content);
    });

    it('throws on invalid JSON instead of faking an empty doc', async () => {
      const file = new TFile('test.note');
      const vault = new Vault();
      vault.read.mockResolvedValue('not valid json {{{');

      // The silent empty-doc fallback was a data-loss path: the empty doc
      // got autosaved over the real file content.
      await expect(
        readNote(file, vault as unknown as ObsidianVault),
      ).rejects.toThrow();
    });
  });

  describe('readNoteWithRaw', () => {
    it('returns the parsed doc and the exact raw string', async () => {
      const file = new TFile('test.note');
      const vault = new Vault();
      const content = { type: 'noteDoc', content: [] };
      const raw = JSON.stringify(content, null, 2);
      vault.read.mockResolvedValue(raw);

      const result = await readNoteWithRaw(file, vault as unknown as ObsidianVault);

      expect(result.doc).toEqual(content);
      expect(result.raw).toBe(raw);
    });

    it('throws on invalid JSON (no silent empty fallback)', async () => {
      const file = new TFile('test.note');
      const vault = new Vault();
      const raw = 'not valid json {{{';
      vault.read.mockResolvedValue(raw);

      await expect(
        readNoteWithRaw(file, vault as unknown as ObsidianVault),
      ).rejects.toThrow();
    });
  });

  describe('parseNoteDoc', () => {
    it('parses valid JSON', () => {
      const content = { type: 'noteDoc', content: [] };
      expect(parseNoteDoc(JSON.stringify(content))).toEqual(content);
    });

    it('throws on invalid JSON (no silent empty fallback)', () => {
      expect(() => parseNoteDoc('{{{')).toThrow();
    });
  });

  describe('isEmptyNoteDoc', () => {
    it('is true for the pristine empty note', () => {
      expect(isEmptyNoteDoc(createEmptyNote())).toBe(true);
    });

    it('is true for an empty title and empty paragraphs', () => {
      const doc = {
        type: 'noteDoc',
        content: [
          { type: 'noteTitle' },
          { type: 'paragraph' },
          { type: 'paragraph', content: [] },
        ],
      };
      expect(isEmptyNoteDoc(doc as never)).toBe(true);
    });

    it('is false when the title has text', () => {
      const doc = JSON.parse(JSON.stringify(EMPTY_DOC)) as {
        content: Array<{ type: string; content?: unknown }>;
      };
      doc.content[0] = {
        type: 'noteTitle',
        content: [{ type: 'text', text: 'Hello' }],
      };
      expect(isEmptyNoteDoc(doc as never)).toBe(false);
    });

    it('is false when a paragraph has text', () => {
      const doc = {
        type: 'noteDoc',
        content: [
          { type: 'noteTitle' },
          { type: 'paragraph', content: [{ type: 'text', text: 'keep me' }] },
        ],
      };
      expect(isEmptyNoteDoc(doc as never)).toBe(false);
    });

    it('is false when a node carries attrs (image, code block, etc.)', () => {
      const doc = {
        type: 'noteDoc',
        content: [
          { type: 'noteTitle' },
          {
            type: 'paragraph',
            content: [{ type: 'image', attrs: { data: { id: 'x' } } }],
          },
        ],
      };
      expect(isEmptyNoteDoc(doc as never)).toBe(false);
    });

    it('is false for a non-noteDoc root', () => {
      expect(isEmptyNoteDoc({ type: 'paragraph' })).toBe(false);
    });
  });

  describe('writeNote', () => {
    it('writes JSON string to vault', async () => {
      const file = new TFile('test.note');
      const vault = new Vault();
      const content = { type: 'noteDoc', content: [] };

      await writeNote(file, vault as unknown as ObsidianVault, content);

      expect(vault.modify).toHaveBeenCalledWith(
        file,
        JSON.stringify(content, null, 2),
      );
    });
  });
});
