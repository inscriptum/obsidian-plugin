import { describe, it, expect } from 'vitest';
import { buildUniquePath, getExtension } from './attachments';

describe('attachments', () => {
  describe('getExtension', () => {
    it('returns extension without dot', () => {
      expect(getExtension('photo.png')).toBe('png');
      expect(getExtension('archive.tar.gz')).toBe('gz');
    });

    it('returns empty string for no extension', () => {
      expect(getExtension('README')).toBe('');
      expect(getExtension('.hidden')).toBe('');
    });
  });

  describe('buildUniquePath', () => {
    const none = () => false;

    it('builds path in the same folder', () => {
      expect(buildUniquePath('notes', 'photo', 'png', none)).toBe('notes/photo.png');
    });

    it('handles root folder', () => {
      expect(buildUniquePath('/', 'photo', 'png', none)).toBe('photo.png');
      expect(buildUniquePath('', 'photo', 'png', none)).toBe('photo.png');
    });

    it('normalizes folder without trailing slash', () => {
      expect(buildUniquePath('notes/sub', 'photo', 'png', none)).toBe('notes/sub/photo.png');
      expect(buildUniquePath('notes/sub/', 'photo', 'png', none)).toBe('notes/sub/photo.png');
    });

    it('appends -1, -2 when file exists', () => {
      const existing = new Set(['notes/photo.png', 'notes/photo-1.png']);
      const exists = (p: string) => existing.has(p);
      expect(buildUniquePath('notes', 'photo', 'png', exists)).toBe('notes/photo-2.png');
    });

    it('works without extension', () => {
      expect(buildUniquePath('notes', 'README', '', none)).toBe('notes/README');
      const existing = new Set(['notes/README']);
      expect(buildUniquePath('notes', 'README', '', (p) => existing.has(p))).toBe(
        'notes/README-1',
      );
    });
  });
});