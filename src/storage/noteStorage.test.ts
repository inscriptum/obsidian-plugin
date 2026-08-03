import { describe, it, expect, vi } from 'vitest';
import { Vault, TFile } from '../__mocks__/obsidian';
import { readNote, writeNote, createEmptyNote, EMPTY_DOC } from './noteStorage';

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

      const result = await readNote(file, vault as any);

      expect(result).toEqual(content);
    });

    it('returns empty doc on invalid JSON', async () => {
      const file = new TFile('test.note');
      const vault = new Vault();
      vault.read.mockResolvedValue('not valid json {{{');

      const result = await readNote(file, vault as any);

      expect(result.type).toBe('noteDoc');
      expect(result.content).toHaveLength(2);
    });
  });

  describe('writeNote', () => {
    it('writes JSON string to vault', async () => {
      const file = new TFile('test.note');
      const vault = new Vault();
      const content = { type: 'noteDoc', content: [] };

      await writeNote(file, vault as any, content as any);

      expect(vault.modify).toHaveBeenCalledWith(
        file,
        JSON.stringify(content, null, 2),
      );
    });
  });
});
