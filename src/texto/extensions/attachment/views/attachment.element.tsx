import {isFunction} from '../../../core/utilities';
import {p} from '@web-companions/gfc';
import {litView} from '@web-companions/lit';
import {type Ref, createRef, ref} from 'lit-html/directives/ref.js';

import type {AttachmentViewNodeState} from '../attachment';
import {fileDeleteIconNode} from './fileDeleteIcon.node';
import {fileIconNode} from './fileIcon.node';
import {placeholderIconNode} from './placeholderIcon.node';

const PlaceholderIconNode = placeholderIconNode();
const FileIconNode = fileIconNode();
const FileDeleteIconNode = fileDeleteIconNode();

export const attachmentElement = litView.element({
	props: {
		state: p.req<AttachmentViewNodeState>(),
		onFileSelected: p.req<(selectedFile: File | null) => void>(),
		onClick: p.req<(event: MouseEvent) => void>(),
		onRemove: p.req<(event: MouseEvent) => void>(),
		onDeleteFile: p.req<(event: MouseEvent) => void>(),
	},
})(function* (params) {
	const inputFileRef: Ref<HTMLInputElement> = createRef();

	const openFileSelection = () => {
		if (inputFileRef.value != null) {
			inputFileRef.value.click();
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

	const AttachmentContainer = () => {
		switch (params.state.fileStatus) {
			case 'loading':
				return (
					<div class="loading-block" data-test-id="attach-loading">
						<div class="icon-note-wrap">
							<FileIconNode />
						</div>
						<div class="progress info-wrap">
							<span class="text">{params.state.text}</span>
							<span class="text">{params.state.subtext}</span>
						</div>
					</div>
				);
			case 'attached':
				return (
					<div class="file-block" data-test-id="attach-attached">
						<div class="icon-note-wrap">
							<FileIconNode />
						</div>
						<div class="info-wrap">
							<span class="text">{params.state.text}</span>
							<span class="text">{params.state.subtext}</span>
						</div>
						<button class="delete-btn" onclick={params.onDeleteFile} data-test-id="attach-delete">
							<FileDeleteIconNode />
						</button>
					</div>
				);
			default:
				return (
					<div class="placeholder-block" onclick={openFileSelection} data-test-id="attach-empty">
						<div class="icon-note-wrap">
							<PlaceholderIconNode />
						</div>
						<span class="text">{params.state.text}</span>
						<button class="delete-btn" onclick={params.onRemove} data-test-id="attach-delete">
							<FileDeleteIconNode />
						</button>
					</div>
				);
		}
	};

	while (true) {
		if (params?.state == null) {
			return;
		}

		if (params.state.isAutoOpenFileSelection) {
			window.requestAnimationFrame(() => {
				openFileSelection();
			});
		}

		if (inputFileRef.value != null) {
			inputFileRef.value.value = '';
		}

		params = yield (
			<div class="texto-extension-attachment" onclick={params.onClick}>
				<AttachmentContainer />

				<input ref={ref(inputFileRef)} type="file" class="input-file" onchange={changeFiles}></input>
			</div>
		);
	}
});
