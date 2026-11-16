# Contributing

Thanks for your interest in developing Inscriptum! This file covers the development setup, tests and the release process. For what the plugin does, see [README.md](README.md).

## Development

Clone the repository and install dependencies:

```bash
git clone https://github.com/inscriptum/obsidian-plugin.git
cd obsidian-plugin
npm ci
```

Start the development build:

```bash
npm run dev
```

The development build runs in watch mode and automatically deploys the plugin to:

```text
.obsidian/plugins/inscriptum/
```

Create a production build:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Type-check the codebase (`vite build` does not check types; CI runs this on
every push, so keep it clean):

```bash
npm run typecheck
```

For a continuous check while refactoring:

```bash
npm run typecheck:watch
```

## E2E tests

Browser tests run the real editor (ProseMirror + extensions) in Chromium via
Playwright, against a harness page with a shimmed `obsidian` module
(`src/browser-harness/`). Install the browser once, then run:

```bash
npx playwright install chromium
npm run test:e2e
```

Useful variants: `npm run test:e2e:headed` (visible browser) and
`npm run test:e2e:ui` (Playwright UI mode). CI runs the same suite on every
push (see `.github/workflows/ci.yml`).

## Release

Releases are built automatically by GitHub Actions.

Create a new version and push the tag:

```bash
npm version patch
git push --follow-tags
```

The workflow builds the plugin, takes the release notes for the new version
from [CHANGELOG.md](CHANGELOG.md), and publishes the release automatically.

Before pushing the tag, add a `## [x.y.z]` section to CHANGELOG.md describing
the changes — the release will be created only if that section exists.
