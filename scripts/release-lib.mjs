export const RELEASE_TYPES = ['patch', 'minor', 'major'];

export function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim());
  if (!match) {
    throw new Error(`Invalid semver version: "${version}"`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function bumpVersion(version, type) {
  if (!RELEASE_TYPES.includes(type)) {
    throw new Error(`Unknown release type: "${type}"`);
  }
  const { major, minor, patch } = parseVersion(version);
  if (type === 'major') {
    return `${major + 1}.0.0`;
  }
  if (type === 'minor') {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

function stringifyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function bumpPackageJson(content, newVersion) {
  const data = JSON.parse(content);
  data.version = newVersion;
  return stringifyJson(data);
}

export function bumpPackageLock(content, newVersion) {
  const data = JSON.parse(content);
  data.version = newVersion;
  if (data.packages && data.packages['']) {
    data.packages[''].version = newVersion;
  }
  return stringifyJson(data);
}

export function bumpManifest(content, newVersion) {
  const data = JSON.parse(content);
  data.version = newVersion;
  return stringifyJson(data);
}

export function addVersionsEntry(content, newVersion, minAppVersion) {
  const data = JSON.parse(content);
  return stringifyJson({ [newVersion]: minAppVersion, ...data });
}

export function updateChangelog(content, newVersion, date) {
  const header = `## [${newVersion}] - ${date}`;
  const lines = content.split('\n');

  const unreleasedIndex = lines.findIndex((line) => line === '## [Unreleased]');
  if (unreleasedIndex !== -1) {
    lines[unreleasedIndex] = header;
    return lines.join('\n');
  }

  const section = [header, '', '### Added', '', '### Changed', '', '### Fixed', ''];
  const headingIndex = lines.findIndex((line) => line.startsWith('## ['));

  if (headingIndex === -1) {
    return `${lines.join('\n').trimEnd()}\n\n${section.join('\n')}\n`;
  }

  lines.splice(headingIndex, 0, ...section);
  return lines.join('\n');
}
