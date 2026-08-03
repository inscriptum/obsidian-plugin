const HLJS_CSS_CLASS = 'hljs';

export function updateHljsElCssClass(el: HTMLElement, cssClass: string | string[]) {
	if (Array.isArray(cssClass)) {
		el.className = `${HLJS_CSS_CLASS} ${cssClass.join(' ')}`;
	} else {
		el.className = `${HLJS_CSS_CLASS} ${cssClass}`;
	}
}
