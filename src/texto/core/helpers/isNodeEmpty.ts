import type {Node as ProseMirrorNode} from 'prosemirror-model';

export function isNodeEmpty(node: ProseMirrorNode, skipAttr = false): boolean {
	const defaultContent = node.type.createAndFill()?.toJSON();
	const content = node.toJSON();

	if (skipAttr) {
		delete defaultContent.attrs;
		delete content.attrs;
	}

	return JSON.stringify(defaultContent) === JSON.stringify(content);
}
