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
	({state, dispatch}) => {
		return originalJoinUp(state, dispatch);
	};

/**
 * Join two nodes Down.
 */
export const joinDown =
	(): Command =>
	({state, dispatch}) => {
		return originalJoinDown(state, dispatch);
	};

/**
 * Join two nodes Backwards.
 */
export const joinBackward =
	(): Command =>
	({state, dispatch}) => {
		return originalJoinBackward(state, dispatch);
	};

/**
 * Join two nodes Forwards.
 */
export const joinForward =
	(): Command =>
	({state, dispatch}) => {
		return originalJoinForward(state, dispatch);
	};
