/**
 * Remove a property or an array of properties from an object
 * @param obj Object
 * @param key Key to remove
 */
export function deleteProps(obj: Record<string, unknown>, propOrProps: string | string[]): Record<string, unknown> {
	const props = typeof propOrProps === 'string' ? [propOrProps] : propOrProps;

	return Object.keys(obj).reduce((newObj: Record<string, unknown>, prop) => {
		if (!props.includes(prop)) {
			newObj[prop] = obj[prop];
		}

		return newObj;
	}, {});
}
