import {Editor, isNodeSelection, posToDOMRect} from '../../core';
import {getFirstFromAndLastToPos} from '../../core/helpers';
import {EditorState, Plugin, PluginKey, PluginView} from 'prosemirror-state';
import type {EditorView} from 'prosemirror-view';
import tippy, {Instance, Props} from 'tippy.js';

import {shouldShowDefault} from './helpers/shouldShow';

function debounce<T extends (...args: any[]) => void>(fn: T, wait: number) {
	let timer: ReturnType<typeof setTimeout> | null = null;
	return (...args: Parameters<T>) => {
		if (timer !== null) clearTimeout(timer);
		timer = setTimeout(() => fn(...args), wait);
	};
}

export type ShouldShowProps = {
	editor: Editor;
	view: EditorView;
	state: EditorState;
	oldState?: EditorState;
	from: number;
	to: number;
};

export interface BubbleMenuPluginProps {
	pluginKey: PluginKey | string;

	editor: Editor;

	element: HTMLElement;

	tippyOptions?: Partial<Props>;

	updateDelay?: number;

	shouldShow?: ((this: BubbleMenuView, props: ShouldShowProps) => boolean) | null;

	disableHideOnBlur?: boolean;
}

export type BubbleMenuViewProps = BubbleMenuPluginProps & {
	view: EditorView;
};

export class BubbleMenuView implements PluginView {
	public isMousePressed = false;

	public editor: Editor;

	public element: HTMLElement;

	public view: EditorView;

	public preventHide = false;

	public tippy: Instance | undefined;

	public tippyOptions?: Partial<Props>;

	public updateDelay: number;

	public disableHideOnBlur: boolean;

	public pluginKey: string | PluginKey;

	public shouldShow: BubbleMenuPluginProps['shouldShow'];

	constructor({
		pluginKey,
		editor,
		element,
		view,
		tippyOptions = {},
		updateDelay = 250,
		disableHideOnBlur = false,
		shouldShow,
	}: BubbleMenuViewProps) {
		this.pluginKey = pluginKey;
		this.editor = editor;
		this.element = element;
		this.view = view;
		this.updateDelay = updateDelay;
		this.disableHideOnBlur = disableHideOnBlur;

		if (shouldShow) {
			this.shouldShow = shouldShow.bind(this);
		} else {
			this.shouldShow = shouldShowDefault.bind(this);
		}

		document.addEventListener('mousedown', this.setIsMousePressed, {capture: true});
		document.addEventListener('mouseup', this.setIsMousePressed, {capture: true});
		document.addEventListener('mousemove', this.setIsMousePressed, {capture: true});

		this.element.addEventListener('mousedown', this.mousedownHandler, {capture: true});
		this.view.dom.addEventListener('dragstart', this.dragstartHandler);
		this.editor.on('focus', this.focusHandler);
		this.editor.on('blur', this.blurHandler);
		this.tippyOptions = tippyOptions;
		// Detaches menu content from its current parent
		this.element.remove();
		this.element.style.visibility = 'visible';
	}

	mousedownHandler = () => {
		this.preventHide = true;
	};

	setIsMousePressed = (e: MouseEvent) => {
		const wasMousePressed = this.isMousePressed;

		const buttons = e.buttons !== undefined ? e.buttons : e.which;
		this.isMousePressed = buttons > 0;

		if (wasMousePressed && !this.isMousePressed) {
			setTimeout(() => this.update(this.editor.view));
		}
	};

	dragstartHandler = () => {
		this.hide();
	};

	focusHandler = () => {
		// we use `setTimeout` to make sure `selection` is already updated
		setTimeout(() => this.update(this.editor.view));
	};

	blurHandler = ({event}: {event: FocusEvent}) => {
		if (this.preventHide || this.disableHideOnBlur) {
			this.preventHide = false;

			return;
		}

		if (event?.relatedTarget && this.element.parentNode?.contains(event.relatedTarget as Node)) {
			return;
		}

		this.hide();
	};

	tippyBlurHandler = (event: FocusEvent) => {
		this.blurHandler({event});
	};

	createTooltip() {
		const {element: editorElement} = this.editor.options;
		const editorIsAttached = !!editorElement.parentElement;

		if (this.tippy || !editorIsAttached) {
			return;
		}

		this.tippy = tippy(editorElement, {
			duration: 0,
			getReferenceClientRect: null,
			content: this.element,
			interactive: true,
			trigger: 'manual',
			placement: 'top',
			hideOnClick: 'toggle',
			...this.tippyOptions,
		});

		// Send a tippy object to save inside the plugin's state
		this.editor.view.dispatch(this.editor.state.tr.setMeta(this.pluginKey, this.tippy));

		// maybe we have to hide tippy on its own blur event as well
		if (this.tippy.popper.firstChild) {
			(this.tippy.popper.firstChild as HTMLElement).addEventListener('blur', this.tippyBlurHandler);
		}
	}

	update(view: EditorView, oldState?: EditorState) {
		const {state} = view;
		const hasValidSelection = state.selection.$from.pos !== state.selection.$to.pos;

		if (this.updateDelay > 0 && hasValidSelection) {
			debounce(this.updateHandler, this.updateDelay)(view, oldState);
		} else {
			this.updateHandler(view, oldState);
		}
	}

	updateHandler = (view: EditorView, oldState?: EditorState) => {
		const {state, composing} = view;
		const {doc, selection} = state;
		const isSame = oldState && oldState.doc.eq(doc) && oldState.selection.eq(selection);

		if (composing || isSame || this.editor.isDestroyed) {
			return;
		}

		this.createTooltip();

		// support for CellSelections
		const {from, to} = getFirstFromAndLastToPos(selection.ranges);

		const shouldShow = this.shouldShow?.({
			editor: this.editor,
			view,
			state,
			oldState,
			from,
			to,
		});

		if (!shouldShow) {
			this.hide();

			return;
		}

		this.tippy?.setProps({
			getReferenceClientRect:
				this.tippyOptions?.getReferenceClientRect?.bind(this) ||
				(() => {
					if (isNodeSelection(state.selection)) {
						const node = view.nodeDOM(from) as HTMLElement;

						if (node) {
							return node.getBoundingClientRect();
						}
					}

					return posToDOMRect(view, from, to);
				}),
		});

		this.show();
	};

	show() {
		this.tippy?.show();
	}

	hide() {
		this.tippy?.hide();
	}

	destroy() {
		if (this.tippy?.popper.firstChild) {
			(this.tippy.popper.firstChild as HTMLElement).removeEventListener('blur', this.tippyBlurHandler);
		}

		document.removeEventListener('mousedown', this.setIsMousePressed, {capture: true});
		document.removeEventListener('mouseup', this.setIsMousePressed, {capture: true});
		document.removeEventListener('mousemove', this.setIsMousePressed, {capture: true});

		this.tippy?.destroy();
		this.element.removeEventListener('mousedown', this.mousedownHandler, {capture: true});
		this.view.dom.removeEventListener('dragstart', this.dragstartHandler);
		this.editor.off('focus', this.focusHandler);
		this.editor.off('blur', this.blurHandler);
	}
}

export type BubbleMenuPluginState = {tippy?: Instance};

export function bubbleMenuPlugin(options: BubbleMenuPluginProps) {
	return new Plugin({
		key: typeof options.pluginKey === 'string' ? new PluginKey(options.pluginKey) : options.pluginKey,
		view: (view) => new BubbleMenuView({view, ...options}),
		state: {
			init(): BubbleMenuPluginState {
				return {};
			},
			apply(tr, value) {
				const tippy = tr.getMeta(options.pluginKey);

				if (tippy != null) {
					return {tippy};
				}

				return value;
			},
		},
	});
}
