import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import {
  RELEASE_TYPES,
  bumpVersion,
  bumpPackageJson,
  bumpPackageLock,
  bumpManifest,
  addVersionsEntry,
  updateChangelog,
} from './release-lib.mjs';

const ROOT = new URL('..', import.meta.url);

const FILES = [
  'package.json',
  'package-lock.json',
  'manifest.json',
  'versions.json',
  'CHANGELOG.md',
];

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: ROOT.pathname });
  if (result.status !== 0) {
    fail(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function git(...args) {
  return spawnSync('git', args, { cwd: ROOT.pathname, encoding: 'utf8' });
}

function gitOutput(...args) {
  const result = git(...args);
  if (result.status !== 0) {
    fail(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

async function main() {
  const releaseType = process.argv[2] ?? 'patch';
  if (!RELEASE_TYPES.includes(releaseType)) {
    fail(`Unknown release type "${releaseType}". Use one of: ${RELEASE_TYPES.join(', ')}`);
  }

  const packageJson = JSON.parse(await readFile(new URL('package.json', ROOT), 'utf8'));
  const nextVersion = bumpVersion(packageJson.version, releaseType);

  const dirty = gitOutput('status', '--porcelain');
  if (dirty !== '') {
    fail('Working tree is dirty. Commit or stash changes before releasing.');
  }

  const tag = nextVersion;
  if (gitOutput('tag', '--list', tag) !== '') {
    fail(`Tag ${tag} already exists.`);
  }

  const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
  const versions = JSON.parse(await readFile(new URL('versions.json', ROOT), 'utf8'));
  if (Object.prototype.hasOwnProperty.call(versions, nextVersion)) {
    fail(`Version ${nextVersion} already present in versions.json.`);
  }

  const date = new Date().toISOString().slice(0, 10);

  const transform = {
    'package.json': (content) => bumpPackageJson(content, nextVersion),
    'package-lock.json': (content) => bumpPackageLock(content, nextVersion),
    'manifest.json': (content) => bumpManifest(content, nextVersion),
    'versions.json': (content) => addVersionsEntry(content, nextVersion, manifest.minAppVersion),
    'CHANGELOG.md': (content) => updateChangelog(content, nextVersion, date),
  };

  const nextContents = {};
  for (const file of FILES) {
    const content = await readFile(new URL(file, ROOT), 'utf8');
    nextContents[file] = transform[file](content);
  }

  for (const file of FILES) {
    await writeFile(new URL(file, ROOT), nextContents[file], 'utf8');
  }

  console.log(`Bumped version to ${nextVersion}`);

  run('npm', ['run', 'lint']);
  run('npm', ['test']);
  run('npm', ['run', 'build']);

  const addResult = git('add', ...FILES);
  if (addResult.status !== 0) {
    fail(`git add failed: ${addResult.stderr.trim()}`);
  }

  const commitResult = git('commit', '-m', `release: ${nextVersion}`);
  if (commitResult.status !== 0) {
    fail(`git commit failed: ${commitResult.stderr.trim()}`);
  }

  const tagResult = git('tag', tag);
  if (tagResult.status !== 0) {
    fail(`git tag failed: ${tagResult.stderr.trim()}`);
  }

  console.log(`\nCommitted and tagged ${tag}.`);
  console.log('To publish, run:');
  console.log('  git push origin HEAD --follow-tags');
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
