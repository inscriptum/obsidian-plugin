import {type Fragment, type Schema, DOMSerializer} from 'prosemirror-model';

export function getHTMLFromFragment(fragment: Fragment, schema: Schema): string {
	const documentFragment = DOMSerializer.fromSchema(schema).serializeFragment(fragment);

	// Serialize into an unattached element — innerHTML works on detached nodes,
	// so this never touches the live DOM (no need for a detached document here).
	const container = createDiv();
	container.appendChild(documentFragment);

	return container.innerHTML;
}
