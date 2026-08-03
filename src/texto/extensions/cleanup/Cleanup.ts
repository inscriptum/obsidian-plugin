import {Extension} from '../../core';

import {cleanupPlugin} from './plugins/cleanup.plugin';

export const Cleanup = Extension.create({
	name: 'cleanup',

	addProseMirrorPlugins() {
		return [cleanupPlugin];
	},
});
