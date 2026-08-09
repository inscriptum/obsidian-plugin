import {isRegExp} from './isRegExp';

/**
 * Check if object1 includes object2
 * @param object1 Object
 * @param object2 Object
 */
export function objectIncludes(
	object1: Record<string, unknown>,
	object2: Record<string, unknown>,
	options: {strict: boolean} = {strict: true},
): boolean {
	const keys = Object.keys(object2);

	if (!keys.length) {
		return true;
	}

	return keys.every((key) => {
		if (options.strict) {
			return object2[key] === object1[key];
		}

		if (isRegExp(object2[key])) {
			return object2[key].test(String(object1[key]));
		}

		return object2[key] === object1[key];
	});
}
