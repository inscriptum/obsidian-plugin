import type {Editor} from '../../../core';
import {p} from '@web-companions/gfc';
import {is} from '@web-companions/h/template';
import {litView} from '@web-companions/lit';
import {type Ref, createRef, ref} from 'lit-html/directives/ref.js';

import type {TaskItemOptions} from '../task-item';
import {itemIconNode} from './svg/itemIcon.node';

const ItemIconNode = itemIconNode();

class ItemBaseElement extends HTMLElement {
	role = 'listitem';
}

export const itemElement = litView.element({
	props: {
		checked: p.req<boolean>(),
		content: p.req<HTMLDivElement>(),
		handleCheckboxClick: p.req<(checkboxEl: HTMLInputElement) => void>(),
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
