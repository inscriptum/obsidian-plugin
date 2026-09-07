import type {Editor} from '../../../core';
import {p} from '@web-companions/gfc';
import {is} from '@web-companions/h/template';
import {litView} from '@web-companions/lit';
import {type Ref, createRef, ref} from 'lit-html/directives/ref.js';

import type {TaskItemOptions} from '../task-item';
import {itemIconNode} from './svg/itemIcon.svgnode';

const ItemIconNode = itemIconNode();

class ItemBaseElement extends HTMLElement {
	role = 'listitem';
}

export const itemElement = litView.element({
	props: {
		checked: p.req<boolean>(),
		content: p.req<HTMLDivElement>(),
		/** Whether the item has nested content (subtasks) and can be folded. */
		foldable: p.req<boolean>(),
		handleCheckboxClick: p.req<(checkboxEl: HTMLInputElement) => void>(),
		/** Dispatched on chevron click; the node view toggles the fold state. */
		handleChevronClick: p.req<() => void>(),
		editor: p.req<Editor>(),
		options: p.req<TaskItemOptions>(),
	},
	options: {
		BaseElement: ItemBaseElement,
	},
})(function* (params) {
	const refCheckbox: Ref<HTMLInputElement> = createRef();

	const onClick = (event: Event) => {
		event.stopPropagation();
		event.preventDefault();

		const checkboxEl = refCheckbox.value;
		if (checkboxEl == null) {
			return;
		}

		if (!params.editor.isEditable && !params.options.onReadOnlyChecked) {
			return;
		}

		checkboxEl.checked = !checkboxEl.checked;
		params.handleCheckboxClick(checkboxEl);
	};

	const preventDefault = (event: Event) => {
		event.preventDefault();
	};

	while (true) {
		const options = params.options ?? {};
		const isCustomSvgIcons = Array.isArray(options.checkboxIconLinks);
		const isCustomSvgIconsOn = isCustomSvgIcons && params.checked;

		params = yield (
			<>
				<label
					contentEditable="false"
					onclick={onClick}
					onmousedown={preventDefault} // prevent autofocus, because focus fires when mousedown is successful
				>
					{/* Fold chevron: rendered by the item itself (the label is the
					    anchor for its absolute position in the left gutter); the
					    folded state comes from the `is-folded` node decoration + CSS,
					    exactly like the heading fold chevron. */}
					{is(params.foldable,
						<span
							class="texto-task-fold-chevron"
							contentEditable="false"
							role="button"
							aria-label="Toggle subtasks folding"
							data-testid="task-fold-chevron"
							onpointerdown={preventDefault}
							onclick={(event: Event) => {
								// Must not reach the label's checkbox toggle handler.
								event.stopPropagation();
								event.preventDefault();
								params.handleChevronClick();
							}}
						>
							<svg
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.4"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d="m9 6 6 6-6 6" />
							</svg>
						</span>,
					)}

					{is(
						isCustomSvgIcons,
						<div class="custom-icon">
							<ItemIconNode
								key="taskItemCustomSvgIcon"
								iconId={
									isCustomSvgIconsOn
										? options.checkboxIconLinks?.[0]
										: options.checkboxIconLinks?.[1]
								}
							/>
						</div>,
					)}

					<input
						ref={ref(refCheckbox)}
						type="checkbox"
						checked={params.checked}
						class={isCustomSvgIcons ? 'visually-hidden' : ''}
					></input>
					<span></span>
				</label>
				{params.content}
			</>
		);
	}
});
