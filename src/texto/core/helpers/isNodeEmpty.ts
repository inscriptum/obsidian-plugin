import type {Node as ProseMirrorNode} from 'prosemirror-model';

export function isNodeEmpty(node: ProseMirrorNode, skipAttr = false): boolean {
	const defaultContent = node.type.createAndFill()?.toJSON() as Record<string, unknown> | undefined;
	const content = node.toJSON() as Record<string, unknown>;

	if (skipAttr) {
		delete defaultContent?.attrs;
		delete content.attrs;
	}

	return JSON.stringify(defaultContent) === JSON.stringify(content);
}
