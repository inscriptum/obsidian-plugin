import {dataURLtoBlobSync, isLocalImage} from '../../../utils/image.kit';
import type {NodeType} from 'prosemirror-model';
import {NodeSelection} from 'prosemirror-state';
import type {EditorView} from 'prosemirror-view';

import type {ImageOptionsAttrs} from '../image';

/**
 * Post-processing operations to handle images pasted to Firefox
 *
 * @param type - a current node type
 * @param clipboardText - parsed clipboard plain text
 * @param view - a current editor view
 */
export function processImageInGecko(type: NodeType, clipboardText: string | null, view: EditorView) {
	const {tr} = view.state;

	// Observe mutations inside our contenteditable block to find out new added images
	const observer = new MutationObserver((mutationRecords) => {
		for (const mutation of mutationRecords) {
			for (const addedNode of mutation.addedNodes) {
				if (isLocalImage(addedNode)) {
					const dataUrlSrc = (addedNode as HTMLImageElement).src;
					const blob = dataURLtoBlobSync(dataUrlSrc);

					const ext = blob.type.replace('image/', '');
					let fileName = `local_image.${ext}`;

					if (clipboardText != null && clipboardText.length > 1) {
						fileName = clipboardText.split('/').pop() ?? fileName;
					}

					const file = new File([blob], fileName, {type: blob.type});

					const attrs: Omit<ImageOptionsAttrs, 'key'> = {
						data: null,
						state: {
							preparedData: {
								file,
							},
						},
					};

					tr.replaceSelectionWith(type.create(attrs));
					tr.setSelection(NodeSelection.near(tr.doc.resolve(Math.max(0, tr.selection.from - 1))));
					view.dispatch(tr);

					observer.disconnect();
				}
			}
		}
	});

	// Do observation not so long to prevent poor performance and stop it as soon as it's possible.
	// Actually, 100ms was enough in my local PC (Linux, Intel Core 1.7 GHz), for an 5Mb image.
	// But we will wait in 5 times longer to exclude some corner cases.
	window.setTimeout(() => {
		observer.disconnect();
	}, 500);

	observer.observe(view.dom, {
		childList: true,
		subtree: true,
	});
}
