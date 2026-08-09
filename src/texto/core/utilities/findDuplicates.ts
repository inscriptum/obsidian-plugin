export function findDuplicates<T>(items: T[]): T[] {
	const filtered = items.filter((el, index) => items.indexOf(el) !== index);

	return [...new Set(filtered)];
}
