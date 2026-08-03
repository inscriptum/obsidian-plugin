import { describe, it, expect } from 'vitest';
import type { JSONContent } from '../texto/core/@types';
import {
  extractNoteTitle,
  extractText,
  getDesiredFileName,
  sanitizeFileName,
  MAX_FILENAME_LENGTH,
} from './fileNaming';

function makeDoc(titleText: string): JSONContent {
  return {
    type: 'noteDoc',
    content: [
      { type: 'noteTitle', content: [{ type: 'text', text: titleText }] },
      { type: 'paragraph' },
    ],
  };
}

describe('fileNaming', () => {
  describe('extractText', () => {
    it('returns text of a text node', () => {
      expect(extractText({ type: 'text', text: 'hello' })).toBe('hello');
    });

    it('concatenates nested nodes recursively', () => {
      const node: JSONContent = {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'a' },
          { type: 'text', marks: [{ type: 'bold' }], text: 'b' },
        ],
      };
      expect(extractText(node)).toBe('ab');
    });

    it('returns empty string for undefined', () => {
      expect(extractText(undefined)).toBe('');
    });
  });

  describe('extractNoteTitle', () => {
    it('extracts plain title', () => {
      expect(extractNoteTitle(makeDoc('My Note'))).toBe('My Note');
    });

    it('extracts title with marks (bold etc.)', () => {
      const doc: JSONContent = {
        type: 'noteDoc',
        content: [
          {
            type: 'noteTitle',
            content: [
              { type: 'text', text: 's' },
              { type: 'text', marks: [{ type: 'bold' }], text: 'dfs' },
              { type: 'text', text: 'df' },
            ],
          },
        ],
      };
      expect(extractNoteTitle(doc)).toBe('sdfsdf');
    });

    it('returns empty string when there is no noteTitle', () => {
      const doc: JSONContent = { type: 'noteDoc', content: [] };
      expect(extractNoteTitle(doc)).toBe('');
    });
  });

  describe('sanitizeFileName', () => {
    it('leaves plain titles untouched', () => {
      expect(sanitizeFileName('My Note')).toBe('My Note');
    });

    it('replaces each invalid character with a dash', () => {
      expect(sanitizeFileName('a:b/c\\d?e*f"g<h>i|j')).toBe(
        'a-b-c-d-e-f-g-h-i-j',
      );
    });
  });

  describe('getDesiredFileName', () => {
    it('returns title as file name', () => {
      expect(getDesiredFileName(makeDoc('My Note'))).toBe('My Note');
    });

    it('trims surrounding whitespace', () => {
      expect(getDesiredFileName(makeDoc('  My Note  '))).toBe('My Note');
    });

    it('collapses internal whitespace and newlines', () => {
      expect(getDesiredFileName(makeDoc('My\n  Note'))).toBe('My Note');
    });

    it('trims leading/trailing dots', () => {
      expect(getDesiredFileName(makeDoc(' .My Note. '))).toBe('My Note');
    });

    it('replaces invalid characters with dashes', () => {
      expect(getDesiredFileName(makeDoc('Meeting: Q3'))).toBe('Meeting- Q3');
      expect(getDesiredFileName(makeDoc('What? Really'))).toBe('What- Really');
      expect(getDesiredFileName(makeDoc('a/b*c'))).toBe('a-b-c');
    });

    it('returns null when title is missing', () => {
      expect(getDesiredFileName({ type: 'noteDoc', content: [] })).toBeNull();
    });

    it('returns null when title is empty', () => {
      expect(getDesiredFileName(makeDoc(''))).toBeNull();
    });

    it('returns null when title is only whitespace', () => {
      expect(getDesiredFileName(makeDoc('   \n  '))).toBeNull();
    });

    it('returns null when title is only dots', () => {
      expect(getDesiredFileName(makeDoc('...'))).toBeNull();
    });

    it('returns null when title consists only of invalid characters', () => {
      expect(getDesiredFileName(makeDoc(':::**'))).toBeNull();
    });

    it('truncates long titles', () => {
      const longTitle = 'x'.repeat(300);
      const name = getDesiredFileName(makeDoc(longTitle));
      expect(name).not.toBeNull();
      expect([...(name as string)]).toHaveLength(MAX_FILENAME_LENGTH);
    });

    it('does not split surrogate pairs when truncating', () => {
      const longTitle = 'a'.repeat(MAX_FILENAME_LENGTH - 1) + '😀' + 'b';
      const name = getDesiredFileName(makeDoc(longTitle)) as string;
      expect(name).not.toContain('\uFFFD');
      expect([...name]).toHaveLength(MAX_FILENAME_LENGTH);
      expect(name.endsWith('😀')).toBe(true);
    });

    it('allows emoji in the middle of short titles', () => {
      expect(getDesiredFileName(makeDoc('Привет 😀'))).toBe('Привет 😀');
    });
  });
});
