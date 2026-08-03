/**
 * Take the file extension from the filename or path. Return empty string if it's not found
 *
 * @param fileNamePath - file name or path to file
 */
export function getFileExt(fileNamePath: string) {
	return fileNamePath.split('.').pop()?.toLowerCase() ?? '';
}
