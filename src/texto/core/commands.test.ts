import { describe, it, expect } from 'vitest';
import { Editor } from './Editor';
import { getExtensions } from '../getExtensions';
import type { JSONContent } from './@types';

function createEditor(content?: JSONContent) {
  const defaultContent: JSONContent = { type: 'noteDoc', content: [] };
  return new Editor({
    element: createDiv(),
    content: content ?? defaultContent,
    extensions: getExtensions(),
  });
}

describe('editor commands', () => {
  describe('toggleBold', () => {
    it('applies bold mark to selected text', () => {
      const editor = createEditor({
        type: 'noteDoc',
        content: [
          { type: 'noteTitle', content: [] },
          { type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] },
        ],
      });

      editor.commands.selectAll();
      editor.commands.toggleBold();

      const json = editor.getJSON();
      const paragraph = json.content?.[1];
      expect(paragraph?.content?.[0].marks?.some((m) => m.type === 'bold')).toBe(true);

      editor.destroy();
    });

    it('removes bold mark from already bold text', () => {
      const editor = createEditor({
        type: 'noteDoc',
        content: [
          { type: 'noteTitle', content: [] },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'hello', marks: [{ type: 'bold' }] }],
          },
        ],
      });

      // selectAll may not select everything in noteDoc structure, use setTextSelection instead
      const docSize = editor.state.doc.content.size;
      editor.commands.setTextSelection({ from: 0, to: docSize });
      editor.commands.toggleBold();

      const json = editor.getJSON();
      const paragraph = json.content?.[1];
      
      // The toggled text should no longer have the bold mark
      const hasBold = paragraph?.content?.some((n) => 
        n.marks?.some((m) => m.type === 'bold')
      );
      expect(hasBold).toBe(false);

      editor.destroy();
    });
  });

  describe('toggleItalic', () => {
    it('applies italic mark', () => {
      const editor = createEditor({
        type: 'noteDoc',
        content: [
          { type: 'noteTitle', content: [] },
          { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
        ],
      });

      const docSize = editor.state.doc.content.size;
      editor.commands.setTextSelection({ from: 0, to: docSize });
      editor.commands.toggleItalic();

      const json = editor.getJSON();
      const paragraph = json.content?.[1];
      expect(paragraph?.content?.[0].marks?.some((m) => m.type === 'italic')).toBe(true);

      editor.destroy();
    });
  });

  describe('toggleUnderline', () => {
    it('applies underline mark', () => {
      const editor = createEditor({
        type: 'noteDoc',
        content: [
          { type: 'noteTitle', content: [] },
          { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
        ],
      });

      const docSize = editor.state.doc.content.size;
      editor.commands.setTextSelection({ from: 0, to: docSize });
      editor.commands.toggleUnderline();

      const json = editor.getJSON();
      const paragraph = json.content?.[1];
      expect(paragraph?.content?.[0].marks?.some((m) => m.type === 'underline')).toBe(true);

      editor.destroy();
    });
  });

  describe('toggleStrike', () => {
    it('applies strike mark', () => {
      const editor = createEditor({
        type: 'noteDoc',
        content: [
          { type: 'noteTitle', content: [] },
          { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
        ],
      });

      const docSize = editor.state.doc.content.size;
      editor.commands.setTextSelection({ from: 0, to: docSize });
      editor.commands.toggleStrike();

      const json = editor.getJSON();
      const paragraph = json.content?.[1];
      expect(paragraph?.content?.[0].marks?.some((m) => m.type === 'strike')).toBe(true);

      editor.destroy();
    });
  });

  describe('setColor / unsetColor', () => {
    it('sets color via textStyle mark', () => {
      const editor = createEditor({
        type: 'noteDoc',
        content: [
          { type: 'noteTitle', content: [] },
          { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
        ],
      });

      const docSize = editor.state.doc.content.size;
      editor.commands.setTextSelection({ from: 0, to: docSize });
      editor.commands.setColor('#ff0000');

      const json = editor.getJSON();
      const paragraph = json.content?.[1];
      const textStyles = paragraph?.content?.[0].marks?.filter((m) => m.type === 'textStyle');
      expect(textStyles?.length).toBeGreaterThan(0);

      editor.destroy();
    });
  });

  describe('setContent / getJSON', () => {
    it('sets and gets content correctly', () => {
      const editor = createEditor();

      const content = {
        type: 'noteDoc',
        content: [
          { type: 'noteTitle', content: [{ type: 'text', text: 'Title' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Body text' }] },
        ],
      };

      editor.commands.setContent(content);
      const json = editor.getJSON();

      expect(json.type).toBe('noteDoc');
      expect(json.content?.[0]?.content?.[0]?.text).toBe('Title');
      expect(json.content?.[1]?.content?.[0]?.text).toBe('Body text');

      editor.destroy();
    });
  });

  describe('toggleTaskList', () => {
    it('is available as command', () => {
      const editor = createEditor({
        type: 'noteDoc',
        content: [
          { type: 'noteTitle', content: [] },
          { type: 'paragraph', content: [{ type: 'text', text: 'todo item' }] },
        ],
      });

      const commands = editor.commands;
      expect(typeof commands.toggleTaskList).toBe('function');

      editor.destroy();
    });
  });
});