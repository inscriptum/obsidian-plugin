import {litView} from '@web-companions/lit';
import {createRef, ref} from 'lit-html/directives/ref.js';

import type {UpdateFn, ViewNodeData, ViewNodeState} from '../image';
import {imageErrorNode} from './imageError.node';
import {imageLoadingNode} from './imageLoading.node';

const ImageLoadingNode = imageLoadingNode();
const ImageErrorNode = imageErrorNode();

export const imageContainerNode = litView.node(function* (params: {
	key: string;
	data: ViewNodeData;
	state?: ViewNodeState;
	onClick?: (ev: MouseEvent) => any;
	onRemove: (ev: MouseEvent) => any;
	updateAttrs: UpdateFn;
}) {
	const imgRef = createRef<HTMLImageElement>();
	// NOTE: pay attention, we can store only temporal property inside views.
	// So that we connect a local property to a global key attribute to be shure that it's actual
	const isImageReadyByKey = {[params.key]: false};

	const handleImageLoad = (key: string) => () => {
		isImageReadyByKey[key] = true;

		void this.next();
	};

	const handleImageError = () => {
		params.updateAttrs({
			...params,
			state: {
				...params.state,
				error: '',
			},
		});
	};

	while (true) {
		requestAnimationFrame(() => {
			if (
				imgRef.value != null &&
				imgRef.value.complete &&
				isImageReadyByKey[params.key] !== imgRef.value.complete
			) {
				isImageReadyByKey[params.key] = imgRef.value.complete;
				
				void this.next();
			}
		});

		// Don't show anything for a new image without state
		if (params.data.id == null && params.state == null) {
			params = yield <></>;
			continue;
		}

		const alt = params.data.alt || params.data.filename || '';
		const {src, text, subtext, error} = params.state ?? {text: '', subtext: ''};

		const isPlaceholder = (src == null || !isImageReadyByKey[params.key]) && error == null;

		params = yield (
			<>
				{is(
					error != null,
					<ImageErrorNode
						key={`${params.key}_imageContainerNode_error`}
						text={error || ''}
						onRemove={params.onRemove}
					></ImageErrorNode>,
				)}
				{is(
					isPlaceholder,
					<ImageLoadingNode
						key={`${params.key}_imageContainerNode_loading`}
						text={text || ''}
						subtext={subtext || ''}
					></ImageLoadingNode>,
				)}
				{is(
					src != null && error == null,
					<div
						class={`image-container${isImageReadyByKey[params.key] ? '' : ' hidden'}`}
						onclick={params.onClick}
					>
						<img
							ref={ref(imgRef)}
							class="image"
							src={src}
							alt={alt}
							onload={handleImageLoad(params.key)}
							onerror={handleImageError}
						></img>
					</div>,
				)}
			</>
		);
	}
});

function is<T>(condition: boolean, value: T) {
	return condition ? value : undefined;
}
