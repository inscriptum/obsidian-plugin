import {
  type Node as ProseMirrorNode,
  type ParseOptions,
  type Schema,
  DOMParser,
  Fragment,
} from 'prosemirror-model';

import type { Content } from '../@types';
import { elementFromString } from '../utilities/elementFromString';

export type CreateNodeFromContentOptions = {
  slice?: boolean;
  parseOptions?: ParseOptions;
};

export function createNodeFromContent(
  content: Content,
  schema: Schema,
  options?: CreateNodeFromContentOptions,
): ProseMirrorNode | Fragment {
  options = {
    slice: true,
    parseOptions: {},
    ...options,
  };

  let node: ProseMirrorNode | Fragment | null = null;
  if (typeof content === 'object' && content != null) {
    if (Array.isArray(content)) {
      node = Fragment.fromArray(content.map((item) => schema.nodeFromJSON(item)));
    }

    if (Object.hasOwn(content, 'type')) {
      node = schema.nodeFromJSON(content);
    }
  }

  if (typeof content === 'string') {
    const parser = DOMParser.fromSchema(schema);

    node = options.slice
      ? parser.parseSlice(elementFromString(content), options.parseOptions).content
      : parser.parse(elementFromString(content), options.parseOptions);
  }

  return node ?? createNodeFromContent('', schema, options);
}
