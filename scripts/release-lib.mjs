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
