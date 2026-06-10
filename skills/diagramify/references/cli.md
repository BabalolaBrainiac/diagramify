# Diagramify CLI Reference

Use `npx diagramify` when Diagramify is a project dependency. Substitute `diagramify` when a global binary is already available.

## Generate

Generate from a repository:

```bash
npx diagramify generate \
  --path . \
  --type flowchart \
  --direction LR \
  --provider anthropic \
  --out mmd,html,svg \
  --outdir diagrams \
  --name system-architecture
```

Generate from a description:

```bash
npx diagramify generate \
  --description "Browser calls API Gateway over HTTPS. Gateway validates JWT with Auth0, calls Orders API, and Orders API reads PostgreSQL and publishes order-created events to Kafka." \
  --type flowchart \
  --out mmd,html,svg \
  --outdir diagrams \
  --name order-platform
```

Useful flags:

| Flag | Meaning |
|---|---|
| `--path <dir>` | Repository or subsystem root; defaults to current directory |
| `--description <text>` | Generate from text instead of analyzing a path |
| `--type <type>` | `flowchart`, `sequence`, `class`, `er`, `state`, or `auto` |
| `--direction <dir>` | Flowchart direction: `LR`, `TD`, `TB`, or `RL` |
| `--out <formats>` | Comma-separated `mmd`, `html`, `svg`, `png`, `jpeg` |
| `--outdir <dir>` | Output directory; defaults to current directory |
| `--name <name>` | Base output filename; defaults to `diagram` |
| `--provider <name>` | `anthropic`, `openai`, or `google` |
| `--model <id>` | Provider-specific model override |
| `--theme <name>` | Render theme |
| `--dark` | Enable dark-mode rendering |
| `--stdout` | Print Mermaid instead of writing files |
| `--json` | Print JSON; raster fields are base64 encoded |

Provider keys:

| Provider | Environment variable | Default model |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6` |
| OpenAI | `OPENAI_API_KEY` | `gpt-4o` |
| Google | `GOOGLE_GENERATIVE_AI_API_KEY` or `GEMINI_API_KEY` | `gemini-2.5-flash` |

## Render

Render and validate an existing source:

```bash
npx diagramify render diagrams/system-architecture.mmd \
  --out html,svg,png \
  --outdir diagrams \
  --name system-architecture \
  --theme dark \
  --width 1800
```

Render from stdin:

```bash
printf 'flowchart LR\nA[Client] --> B[API]\n' | npx diagramify render - --out svg --stdout
```

`render` defaults to `svg,html`, writes to the current directory unless `--outdir` is supplied, and uses `diagram` as the default base name. `--quality` controls JPEG quality.

## Preview

```bash
npx diagramify preview --file diagrams/system-architecture.mmd --port 3050 --theme dark
```

Add `--open` only when opening the browser is appropriate. Stop the long-running preview server after review.

## Diff

Diff parsing is designed for flowcharts. Keep node IDs stable between versions.

```bash
mkdir -p diagrams/diff
npx diagramify diff diagrams/v1.mmd diagrams/v2.mmd \
  --out html,mmd \
  --outdir diagrams/diff \
  --name architecture-change \
  --theme light
```

Create the output directory first. Current CLI support reliably writes `html` and `mmd`; do not rely on `svg` diff output without verifying it.

## CI

The CI provider is a positional argument:

```bash
npx diagramify ci github --outdir diagrams --branch main
npx diagramify ci gitlab --outdir diagrams --branch main
npx diagramify ci precommit --outdir diagrams
```

Add `--commit` only when generated diagrams should be committed automatically. Inspect generated workflows before completion and ensure the required provider secret is configured in CI.

## Initialize Configuration

```bash
npx diagramify init
```

Configuration precedence is: explicit command/API overrides, Diagramify environment variables, `diagramify.config.ts` or `.js`, then built-in defaults. A provider-specific API key is resolved after merging.
