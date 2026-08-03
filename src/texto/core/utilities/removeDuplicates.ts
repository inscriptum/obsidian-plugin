/**
 * Removes duplicated values within an array.
 * Supports numbers, strings and objects.
 */
export function removeDuplicates<T>(array: T[], by = JSON.stringify): T[] {
	const seen: Record<any, any> = {};

	return array.filter((item) => {
		const key = by(item);

		// eslint-disable-next-line no-return-assign
		return Object.prototype.hasOwnProperty.call(seen, key) ? false : (seen[key] = true);
	});
}
