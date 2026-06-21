# Security Policy

## Supported Versions

Security fixes are provided for the latest published version of `diagramify-ai`.

## Reporting a Vulnerability

Do not open a public issue for a vulnerability. Use
[GitHub private vulnerability reporting](https://github.com/BabalolaBrainiac/diagramify/security/advisories/new).

Include affected versions, impact, reproduction steps, and any suggested
mitigation. Do not include real API keys or private source code.

## Known Production Dependency Vulnerabilities

As of `v0.2.1`, `npm audit` reports **9 production vulnerabilities** (7 low, 2 moderate)
with **no upstream fix available**. These are tracked here for transparency.

Run `npm run audit:prod` to see the current status before publishing.

| Vulnerability path | Severity | Upstream fix | Notes |
|--------------------|----------|-------------|-------|
| `@ai-sdk/provider-utils` (via `ai`) | Moderate | None available | Vercel AI SDK transitive; waiting on upstream release |
| `jsondiffpatch` | Low | None available | Used internally for diff output; not user-facing |

### Workaround

These vulnerabilities are **not exploitable via the Diagramify CLI or public API surface** —
they are in transitive dependencies that are invoked only with trusted inputs (your own
codebase and LLM responses). No untrusted user input flows through these paths.

Consumers who require a clean audit should pin an alternative AI SDK version via
[npm overrides](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#overrides) once
an upstream fix is published.

We will update this section when upstream fixes are released.
