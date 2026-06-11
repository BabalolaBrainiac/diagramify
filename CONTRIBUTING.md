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

Use `npm run dev` while changing the library. For a CLI smoke test:

```bash
npm run build
node dist/cli/index.js render examples/test-diagram.mmd --out svg --outdir /tmp/diagramify
```

## Pull Requests

- Keep changes focused and add regression tests for behavior changes.
- Run `npm run check` before opening a pull request.
- Update `README.md` and `CHANGELOG.md` when public behavior changes.
- Do not commit API keys, private codebase output, or generated diagrams.

By contributing, you agree that your contributions are licensed under the
project's MIT License.
