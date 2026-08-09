import {isFunction} from '../../../core';
import {p} from '@web-companions/gfc';
import {litView} from '@web-companions/lit';

import {type SupportedLanguage, LANGUAGES} from '../utils/hljs';

export const codeBlockSelectLangElement = litView.element({
	props: {
		domCodeEl: p.req<HTMLElement>(),
		disabled: p.req<boolean>(),
		selectedLanguage: p.opt<string>(),
		onChange: p.opt<(language: SupportedLanguage | null) => void>(),
	},
})(function* (params) {
	const updateAttributes = (event: Event) => {
		const target = event.target as HTMLSelectElement;
		if (isFunction(params.onChange)) {
			const value = target.value as SupportedLanguage | 'null';
			params.onChange(value === 'null' ? null : value);
		}
	};

	while (true) {
		params = yield (
			<>
				<pre>{params.domCodeEl}</pre>
				<select
					disabled={params.disabled}
					class="hljs-codeblock__select"
					contentEditable={false}
					value={params.selectedLanguage}
					onchange={updateAttributes}
				>
					<option value="null" selected={params.selectedLanguage == null}>
						auto
					</option>
					<option disabled={true}>—</option>
					{LANGUAGES.map(
						(lang) => (
							<option key={lang} value={lang} selected={params.selectedLanguage === lang}>
								{lang}
							</option>
						),
					)}
				</select>
			</>
		);
	}
});
