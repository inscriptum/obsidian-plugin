import {Platform} from 'obsidian';

export function isiOS(): boolean {
	return Platform.isIosApp;
}
