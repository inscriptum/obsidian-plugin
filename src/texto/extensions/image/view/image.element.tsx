import {isFunction} from '../../../core/utilities';
import {p} from '@web-companions/gfc';
import {litView} from '@web-companions/lit';
import {type Ref, createRef, ref} from 'lit-html/directives/ref.js';

import type {ImageOptions, UpdateFn, ViewNodeData, ViewNodeState} from '../image';
import {imageContainerNode} from './imageContainer.node';

const ImageContainerNode = imageContainerNode();

export const imageElement = litView.element({
	props: {
		key: p.req<string>('key'),
		options: p.req<ImageOptions>(),
		data: p.req<ViewNodeData>(),
		state: p.opt<ViewNodeState>(),
		onFileSelected: p.opt<(selectedFile: File | null) => void>(),
		onClick: p.opt<(event: MouseEvent) => void>(),
		onOpenFileSelection: p.req<() => void>(),
		onRemove: p.req<(event: MouseEvent) => void>(),
		updateAttrs: p.req<UpdateFn>(),
	},
})(function* (params) {
	const inputFileRef: Ref<HTMLInputElement> = createRef();

	const openFileSelection = () => {
		if (inputFileRef.value != null) {
			inputFileRef.value.onclick = params.onOpenFileSelection;

			inputFileRef.value.click();
		} else {
			console.warn('[TEXTO WARN]: Image element does not exist yet!');
		}
	};

	const changeFiles = (event: InputEvent) => {
		const target = event.currentTarget as HTMLInputElement;
		let selectedFile: File | null = null;

		if (target != null && target.files != null) {
			selectedFile = target.files.item(0);
		}

		if (isFunction(params.onFileSelected)) {
			params.onFileSelected(selectedFile);
		}
	};

	while (true) {
		requestAnimationFrame(() => {
			if (params.state?.isAutoOpenFileSelection) {
				openFileSelection();
			}
		});

		if (inputFileRef.value != null) {
			inputFileRef.value.value = '';
		}

		params = yield (
			<>
				<ImageContainerNode
					key={params.key}
					state={params.state}
					data={params.data}
					onClick={params.onClick}
					onRemove={params.onRemove}
					updateAttrs={params.updateAttrs}
				></ImageContainerNode>
				<input
					ref={ref(inputFileRef)}
					type="file"
					accept={params.options.accept}
					class="hidden"
					onchange={changeFiles}
				></input>
			</>
		);
	}
});
