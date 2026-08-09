import {Node as ProseMirrorNode} from 'prosemirror-model';
import {NodeView} from 'prosemirror-view';

export function updateColumns(
	node: ProseMirrorNode,
	colgroup: HTMLElement,
	table: HTMLElement,
	cellMinWidth: number,
	overrideCol?: number,
	overrideValue?: any,
) {
	let totalWidth = 0;
	let fixedWidth = true;
	let nextDOM = colgroup.firstChild;
	const row = node.firstChild;

	for (let i = 0, col = 0; row && i < row.childCount; i += 1) {
		const {colspan, colwidth} = row.child(i).attrs;

		for (let j = 0; j < colspan; j += 1, col += 1) {
			const hasWidth = overrideCol === col ? overrideValue : colwidth && colwidth[j];
			const cssWidth = hasWidth ? `${hasWidth}px` : '';

			totalWidth += hasWidth || cellMinWidth;

			if (!hasWidth) {
				fixedWidth = false;
			}

			if (!nextDOM) {
				colgroup.appendChild(createEl('col')).style.width = cssWidth;
			} else if (
				'style' in nextDOM &&
				typeof nextDOM.style === 'object' &&
				!!nextDOM.style &&
				'width' in nextDOM.style
			) {
				if (nextDOM.style.width !== cssWidth) {
					nextDOM.style.width = cssWidth;
				}

				nextDOM = nextDOM.nextSibling;
			}
		}
	}

	while (nextDOM) {
		const after = nextDOM.nextSibling;

		nextDOM.parentNode?.removeChild(nextDOM);
		nextDOM = after;
	}

	if (fixedWidth) {
		table.style.width = `${totalWidth}px`;
		table.style.removeProperty('min-width');
	} else {
		table.style.removeProperty('width');
		table.style.minWidth = `${totalWidth}px`;
	}
}

export class TableView implements NodeView {
	node: ProseMirrorNode;
	cellMinWidth: number;
	dom: HTMLElement;
	table: HTMLElement;
	colgroup: HTMLElement;
	contentDOM: HTMLElement;

	constructor(node: ProseMirrorNode, cellMinWidth: number) {
		this.node = node;
		this.cellMinWidth = cellMinWidth;
		this.dom = createDiv();
		this.dom.className = 'table-wrapper';
		this.table = this.dom.appendChild(createEl('table'));
		this.colgroup = this.table.appendChild(createEl('colgroup'));
		updateColumns(node, this.colgroup, this.table, cellMinWidth);
		this.contentDOM = this.table.appendChild(createEl('tbody'));
	}

	update(node: ProseMirrorNode) {
		if (node.type !== this.node.type) {
			return false;
		}

		this.node = node;
		updateColumns(node, this.colgroup, this.table, this.cellMinWidth);

		return true;
	}

	ignoreMutation(mutation: any) {
		return (
			mutation.type === 'attributes' &&
			(mutation.target === this.table || this.colgroup.contains(mutation.target))
		);
	}
}
