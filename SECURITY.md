# Security Policy

## Supported Versions

Security fixes are provided for the latest published version of `diagramify-ai`.

## Reporting a Vulnerability

Do not open a public issue for a vulnerability. Use
[GitHub private vulnerability reporting](https://github.com/BabalolaBrainiac/diagramify/security/advisories/new).

Include affected versions, impact, reproduction steps, and any suggested
mitigation. Do not include real API keys or private source code.

## Production Dependency Status

`npm run audit:prod` reports **0 production vulnerabilities** as of `v0.3.0`.

Run `npm run audit:prod` before every publish. The `prepublishOnly` script does
not run it, so run it yourself.

### Known development-only advisories

These advisories affect build and release tooling only. They never ship to a
consumer, because `files` in `package.json` publishes `dist/` and `skills/` only.

| Path | Severity | Status |
|------|----------|--------|
| `tmp` (via `np` -> `listr-input` -> `inquirer`) | High | No upstream fix. Runs at release time on a maintainer machine, with maintainer input only. |
| `esbuild` (via `vitest` -> `vite`) | Low | Affects the Vite dev server, which this project does not start. |

### Trust boundaries

- The CLI reads your codebase and sends a summary to the provider you configure.
- An LLM response is treated as untrusted text. It is parsed as Mermaid, never executed.
- The `preview` and `watch` servers bind to localhost. Do not expose them to a network.
- An API key is read from the environment or a config file. Diagramify never logs it.

We will update this section when upstream fixes are released.
