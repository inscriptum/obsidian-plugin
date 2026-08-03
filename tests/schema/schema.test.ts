import { describe, it, expect } from 'vitest';
import { buildSchema } from '../helpers/buildSchema';

describe('schema contract', () => {
  const schema = buildSchema();

  it('has all required node types', () => {
    const requiredNodes = [
      'noteDoc',
      'noteTitle',
      'paragraph',
      'text',
      'heading',
      'blockquote',
      'bulletList',
      'orderedList',
      'listItem',
      'hardBreak',
      'horizontalRule',
      'image',
      'attachment',
      'hljsCodeBlock',
      'hljsCodeBlockRow',
      'table',
      'tableRow',
      'tableCell',
      'tableHeader',
      'taskList',
      'taskItem',
    ];

    for (const name of requiredNodes) {
      expect(schema.nodes[name], `missing node ${name}`).toBeDefined();
    }
  });

  it('has all required mark types', () => {
    const requiredMarks = [
      'bold',
      'italic',
      'strike',
      'code',
      'underline',
      'highlight',
      'textStyle',
      'link',
    ];

    for (const name of requiredMarks) {
      expect(schema.marks[name], `missing mark ${name}`).toBeDefined();
    }
  });

  it('topNode is noteDoc', () => {
    expect(schema.spec.topNode).toBe('noteDoc');
  });
});