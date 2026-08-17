import { describe, it, expect } from 'vitest';
import {
  bumpVersion,
  bumpPackageJson,
  bumpPackageLock,
  bumpManifest,
  addVersionsEntry,
  updateChangelog,
} from '../../scripts/release-lib.mjs';

describe('bumpVersion', () => {
  it('bumps patch', () => {
    expect(bumpVersion('0.1.1', 'patch')).toBe('0.1.2');
  });

  it('bumps minor and resets patch', () => {
    expect(bumpVersion('0.1.5', 'minor')).toBe('0.2.0');
  });

  it('bumps major and resets minor and patch', () => {
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0');
  });

  it('throws on unknown release type', () => {
    expect(() => bumpVersion('0.1.1', 'prerelease')).toThrow(/Unknown release type/);
  });

  it('throws on malformed version', () => {
    expect(() => bumpVersion('not-a-version', 'patch')).toThrow(/Invalid semver version/);
  });
});

describe('JSON file updates', () => {
  it('bumpPackageJson sets version and preserves other fields', () => {
    const input = '{\n  "name": "@inscriptum/obsidian-plugin",\n  "version": "0.1.1",\n  "license": "MIT"\n}\n';
    const output = bumpPackageJson(input, '0.2.0');
    const data = JSON.parse(output);
    expect(data.version).toBe('0.2.0');
    expect(data.name).toBe('@inscriptum/obsidian-plugin');
    expect(data.license).toBe('MIT');
    expect(output.endsWith('\n')).toBe(true);
  });

  it('bumpPackageLock sets top-level and root package version', () => {
    const input = JSON.stringify({
      version: '0.1.1',
      packages: { '': { name: 'x', version: '0.1.1' } },
    });
    const output = bumpPackageLock(input, '0.2.0');
    const data = JSON.parse(output);
    expect(data.version).toBe('0.2.0');
    expect(data.packages[''].version).toBe('0.2.0');
  });

  it('bumpManifest sets version', () => {
    const input = JSON.stringify({ id: 'inscriptum', version: '0.1.1', minAppVersion: '1.6.6' });
    const output = bumpManifest(input, '0.2.0');
    expect(JSON.parse(output).version).toBe('0.2.0');
    expect(JSON.parse(output).minAppVersion).toBe('1.6.6');
  });

  it('addVersionsEntry prepends the new version', () => {
    const input = '{\n  "0.1.1": "1.5.0",\n  "0.1.0": "1.5.0"\n}\n';
    const output = addVersionsEntry(input, '0.2.0', '1.6.6');
    const data = JSON.parse(output);
    expect(Object.keys(data)[0]).toBe('0.2.0');
    expect(data['0.2.0']).toBe('1.6.6');
    expect(Object.keys(data)).toHaveLength(3);
  });
});

describe('updateChangelog', () => {
  it('renames an existing Unreleased section', () => {
    const input = '# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- a fix\n';
    const output = updateChangelog(input, '0.2.0', '2026-08-17');
    expect(output).toContain('## [0.2.0] - 2026-08-17');
    expect(output).not.toContain('## [Unreleased]');
    expect(output).toContain('- a fix');
  });

  it('throws when there is no Unreleased section', () => {
    const input = '# Changelog\n\n<!-- ## [Unreleased] -->\n\n## [0.1.1] - 2026-08-10\n\n### Fixed\n\n- a fix\n';
    expect(() => updateChangelog(input, '0.2.0', '2026-08-17')).toThrow(/Unreleased/);
  });
});
