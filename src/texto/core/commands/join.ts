import {
	joinBackward as originalJoinBackward,
	joinDown as originalJoinDown,
	joinForward as originalJoinForward,
	joinUp as originalJoinUp,
} from 'prosemirror-commands';

import type {Command} from '../@types';

/**
 * Join two nodes Up.
 */
export const joinUp =
	(): Command =>
	// eslint-disable-next-line unicorn/consistent-function-scoping
	({state, dispatch}) => {
		return originalJoinUp(state, dispatch);
	};

/**
 * Join two nodes Down.
 */
export const joinDown =
	(): Command =>
	// eslint-disable-next-line unicorn/consistent-function-scoping
	({state, dispatch}) => {
		return originalJoinDown(state, dispatch);
	};

/**
 * Join two nodes Backwards.
 */
export const joinBackward =
	(): Command =>
	// eslint-disable-next-line unicorn/consistent-function-scoping
	({state, dispatch}) => {
		return originalJoinBackward(state, dispatch);
	};

/**
 * Join two nodes Forwards.
 */
export const joinForward =
	(): Command =>
	// eslint-disable-next-line unicorn/consistent-function-scoping
	({state, dispatch}) => {
		return originalJoinForward(state, dispatch);
	};
