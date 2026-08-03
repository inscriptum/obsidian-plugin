/**
 * Checks whether a given url is an local image (Base64 or blob).
 *
 * @param url - src from img tag or another string with DataUrl
 */
export function isLocalImageUrl(url: string): boolean {
	return /^data:image\/\w+;base64,/g.test(url) || /^blob:/g.test(url);
}

/**
 * Checks whether a given node is an image element with a local source (Base64 or blob).
 *
 * @param node - the node to check.
 */
export function isLocalImage(node: HTMLElement | Node): boolean {
	if (!(node instanceof HTMLImageElement)) {
		return false;
	}

	const src = node.getAttribute('src');

	if (!src) {
		return false;
	}

	return isLocalImageUrl(src);
}

/**
 * Synchronously convert a DataUrl to Blob
 *
 * @param dataUrl - a source DataUrl string
 */
export function dataURLtoBlobSync(dataUrl: string) {
	const splittedUrl = dataUrl.split(',');
	// convert base64 to raw binary data held in a string
	const bytes = atob(splittedUrl[1]);

	// separate out the mime component
	const mime = splittedUrl[0].split(':')[1].split(';')[0];

	// write the bytes of the string to an ArrayBuffer
	const buffer = new ArrayBuffer(bytes.length);
	const arr = new Uint8Array(buffer);

	for (let i = 0; i < bytes.length; i++) {
		arr[i] = bytes.charCodeAt(i);
	}

	return new Blob([buffer], {type: mime});
}
