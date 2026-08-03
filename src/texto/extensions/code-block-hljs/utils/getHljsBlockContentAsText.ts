import {Node as ProsemirrorNode} from 'prosemirror-model';

export function getHljsBlockContentAsText(node: ProsemirrorNode) {
	let codeText = '';

	node.content.forEach((c, point) => {
		codeText += c.textContent;
		if (point + c.nodeSize < node.nodeSize - 2) {
			codeText += '\n';
		}
	});

	return codeText;
}
