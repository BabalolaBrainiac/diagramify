# Contributing to Diagramify

Diagramify is open-source software released under the MIT License. Bug reports,
documentation improvements, tests, and focused code changes are welcome.

## Development

Requirements:

- Node.js 18 or newer
- npm

```bash
git clone https://github.com/BabalolaBrainiac/diagramify.git
cd diagramify
npm ci
npm run check
```

Use `npm run dev` while changing the library.

The development command also rebuilds the browser editor when its source changes.
`src/viewer/session.generated.ts` contains the generated browser script. Do not edit it manually.
`npm run build:viewer` regenerates this file. Build and test commands also regenerate it.

Run this command for a CLI smoke test:

```bash
npm run build
node dist/cli/index.js render examples/test-diagram.mmd --out svg --outdir /tmp/diagramify
```

## Pull Requests

For viewer changes, run the browser tests after the build:

```bash
npx playwright install chromium
npm run test:browser
```

Run `npm run benchmark:viewer` for drag performance changes.
See [the benchmark procedure](docs/performance.md) for the measurement scope.

- Keep changes focused and add regression tests for behavior changes.
- Run `npm run check` before opening a pull request.
- Update `README.md` and `CHANGELOG.md` when public behavior changes.
- Do not commit API keys, private codebase output, or generated diagrams.

By contributing, you agree that your contributions are licensed under the
project's MIT License.
