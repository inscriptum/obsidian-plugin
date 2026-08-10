// see: https://github.com/mesqueeb/is-what/blob/88d6e4ca92fb2baab6003c54e02eedf4e729e5ab/src/index.ts

import type {AnyRecord} from '../@types';

function getType(value: unknown): string {
	return Object.prototype.toString.call(value).slice(8, -1);
}

export function isPlainObject(value: unknown): value is AnyRecord {
	if (getType(value) !== 'Object') {
		return false;
	}

	const record = value as Record<string, unknown>;

	return record.constructor === Object && Object.getPrototypeOf(value) === Object.prototype;
}
