import { Editor } from '../../src/texto/core/Editor';
import { getExtensions } from '../../src/texto/getExtensions';
import { createEmptyNote } from '../../src/storage/noteStorage';

export function buildSchema() {
  const editor = new Editor({
    element: document.createElement('div'),
    content: createEmptyNote(),
    extensions: getExtensions(),
    editable: false,
  });

  const schema = editor.schema;
  editor.destroy();
  return schema;
}
