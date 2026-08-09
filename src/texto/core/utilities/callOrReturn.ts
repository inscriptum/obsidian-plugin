import type {MaybeReturnType} from '../@types';
import {isFunction} from './isFunction';

/**
 * Optionally calls `value` as a function.
 * Otherwise it is returned directly.
 * @param value Function or any value.
 * @param context Optional context to bind to function.
 * @param props Optional props to pass to function.
 */
export function callOrReturn<T>(value: T, context: unknown = undefined, ...props: unknown[]): MaybeReturnType<T> {
	if (isFunction(value)) {
		const fn = value as (...args: unknown[]) => unknown;

		if (context) {
			return fn.bind(context)(...props) as MaybeReturnType<T>;
		}

		return fn(...props) as MaybeReturnType<T>;
	}

	return value as MaybeReturnType<T>;
}
