import { describe, it, expect } from 'vitest';
import { bumpVersion } from '../../scripts/release-lib.mjs';

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
