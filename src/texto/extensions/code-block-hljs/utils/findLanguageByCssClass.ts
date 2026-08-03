import {isString} from '../../../core';

import {aliasToLanguage} from './hljs';

export function findLanguageByCssClass(cssClass: string | string[], languageClassPrefix: string) {
	let cssClassList: string[] = [];

	if (Array.isArray(cssClass)) {
		cssClassList = cssClass;
	}

	if (isString(cssClass)) {
		cssClassList = cssClass.split(' ');
	}

	for (const cssClass of cssClassList) {
		if (cssClass.startsWith(languageClassPrefix)) {
			const language = aliasToLanguage.get(cssClass.slice(languageClassPrefix.length));

			if (language != null) {
				return language;
			}
		} else if (aliasToLanguage.has(cssClass)) {
			return aliasToLanguage.get(cssClass);
		}
	}

	return undefined;
}
