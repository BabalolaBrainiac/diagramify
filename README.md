# Diagramify

[![npm version](https://badge.fury.io/js/diagramify-ai.svg)](https://badge.fury.io/js/diagramify-ai)
[![CI](https://github.com/BabalolaBrainiac/diagramify/actions/workflows/ci.yml/badge.svg)](https://github.com/BabalolaBrainiac/diagramify/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

> Open-source AI-powered Mermaid diagram generator. Analyze a codebase or describe your system → get interactive architecture diagrams in seconds.

Renders to **interactive HTML**, SVG, PNG, JPEG, and Mermaid source. Ships three surfaces: **CLI**, **npm library**, and a **Claude Code skill**. LLM-agnostic via the Vercel AI SDK (Anthropic / OpenAI / Google). Pure TypeScript rendering via `beautiful-mermaid` — no headless browser, no Chromium.

---

## Features

- **Codebase analysis** — automatically map your project's structure, frameworks, services, and inter-module dependencies
- **Natural language input** — describe your system; the LLM produces valid Mermaid syntax
- **Interactive HTML output** — drag nodes, pan/zoom, edit labels, click edges to highlight connections, search, theme switcher, minimap, undo/redo, snap-to-grid, export
- **Fit-to-content on load** — large diagrams auto-scale to fill the viewport on open
- **Orthogonal edge routing** — edges draw as clean L/Z-shaped paths with rounded corners, not long diagonal arcs
- **Works with no LLM at all** — `--no-llm` builds the diagram from the codebase alone. No API key, no network, no cost
- **Typed architecture graph** — one IR that every renderer and exporter reads. A model fills a schema, so the result does not change with the provider
- **Multiple output formats** — `html`, `svg`, `png`, `jpeg`, `mmd`, `pdf`, `drawio`, `excalidraw`, `json`
- **Vector PDF** — real shapes and selectable text, not a picture. No dependency and no headless browser
- **Editable handoff** — `drawio` and `excalidraw` exports keep the layout, so a reviewer can correct the diagram in a tool they already run
- **Drift gate** — `diagramify check` fails a pull request when the diagram no longer matches the code, and names the services that changed
- **Fully offline viewer** — `--offline` produces one HTML file that makes no network request
- **Diagram diffing** — `diagramify diff` compares two `.mmd` files and highlights changes
- **CI integration** — `diagramify ci` generates GitHub Actions / GitLab CI workflows
- **Hot-reload preview** — `diagramify preview` and `diagramify watch` serve and auto-reload on file changes via WebSocket
- **LLM-agnostic** — Claude, OpenAI, or Google Gemini, through schema-constrained output
- **React component** — embed the interactive viewer in any React app
- **No browser required** — pure TypeScript rendering, no Puppeteer

---

## Installation

### CLI (global)

```bash
npm install -g diagramify-ai
```

### Library (per-project)

```bash
npm install diagramify-ai
```

### Claude Code skill

```bash
mkdir -p ~/.claude/skills
cp -R node_modules/diagramify-ai/skills/diagramify ~/.claude/skills/
```

---

## Quick start

### Generate an architecture diagram from your codebase

```bash
cd my-project
diagramify generate --out html,svg,mmd --provider google
```

Opens to an interactive HTML file with draggable nodes, zoom, themes, and export.

### Generate from a description

```bash
diagramify generate \
  --description "Microservices: API gateway → auth service → user-db (PostgreSQL). Events via Kafka." \
  --type flowchart \
  --out html
```

### Render an existing .mmd file

```bash
diagramify render diagram.mmd --out html,svg,png
```

### Commands at a glance

| Command | Purpose | Hot-reload? | WebSocket? |
|---------|---------|------------|------------|
| `diagramify generate` | AI-generate from codebase or description | — | — |
| `diagramify render` | Render an existing `.mmd` file | — | — |
| `diagramify preview [--file]` | Interactive editor with POST API; file watching with `--file` | ✅ | ✅ |
| `diagramify watch <file>` | Lightweight `.mmd` file watcher; no Express | ✅ | ✅ |
| `diagramify dev [--file]` | Alias for `preview` — recommended entry point for dev workflows | ✅ | ✅ |
| `diagramify check` | Fail a build when the diagram no longer matches the code | — | — |
| `diagramify diff` | Compare two `.mmd` files visually | — | — |
| `diagramify ci` | Generate CI workflow files | — | — |
| `diagramify init` | Scaffold a config file | — | — |

> **When to use `watch` vs `preview`:**
> - `watch <file>` — fastest feedback loop for editing a `.mmd` file; no Express, low overhead
> - `preview --file <path>` (or `dev --file <path>`) — same file-watch experience **plus** the POST `/api/update` API for tool integrations and the interactive upload mode when `--file` is omitted

```bash
# Fastest .mmd edit loop
diagramify watch diagram.mmd --open

# Interactive editor + POST API
diagramify preview --file diagram.mmd --open
# or: diagramify dev --file diagram.mmd --open
```

---

## CLI Reference

### `diagramify generate`

Analyze a codebase or description and generate a diagram.

```
diagramify generate [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--path <dir>` | `.` | Codebase root to analyze |
| `--description <text>` | — | Use text instead of codebase analysis |
| `--type <type>` | `auto` | `flowchart` \| `sequence` \| `class` \| `er` \| `state` \| `auto` |
| `--out <formats>` | `svg,mmd` | Comma-separated: `html,svg,png,jpeg,mmd` |
| `--outdir <dir>` | `.` | Output directory |
| `--name <name>` | `diagram` | Base filename |
| `--provider <name>` | `anthropic` | `anthropic` \| `openai` \| `google` |
| `--model <id>` | provider default | Override model ID |
| `--theme <name>` | `light` | Diagram theme |
| `--stdout` | — | Print Mermaid source to stdout |
| `--json` | — | Output JSON with base64 images |

**Examples:**

```bash
# Architecture diagram with interactive output
diagramify generate --out html,svg --provider google

# Sequence diagram from description
diagramify generate --description "User logs in → auth validates → JWT returned" --type sequence

# Use OpenAI GPT-4o
diagramify generate --provider openai --model gpt-4o

# Use Google Gemini (recommended for large codebases)
diagramify generate --provider google --model gemini-flash-latest --out html,svg,png,mmd
```

> **Tip — Gemini on large codebases:** If output is truncated, ensure you are using a non-thinking model variant (e.g. `gemini-flash-latest` rather than `gemini-2.5-flash`). Diagramify automatically sets `thinkingBudget: 0` and `maxTokens: 8192` for Google models to maximise output token budget for Mermaid syntax.

---

### `diagramify render`

Render an existing `.mmd` file to output formats.

```
diagramify render <input.mmd> [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--out <formats>` | `svg,html` | `html,svg,png,jpeg,mmd` |
| `--outdir <dir>` | input file dir | Output directory |
| `--name <name>` | `diagram` | Output filename |
| `--theme <name>` | `light` | `light`, `dark`, `tokyo-night`, `nord`, `catppuccin` |
| `--width <px>` | `1200` | Output width (PNG/JPEG) |
| `--quality <1-100>` | `90` | JPEG quality |
| `--stdout` | — | Print SVG to stdout |

```bash
# Render to interactive HTML
diagramify render architecture.mmd --out html --theme dark

# Render to high-res PNG
diagramify render diagram.mmd --out png --width 2400
```

---

### `diagramify preview` / `diagramify dev`

Interactive diagram editor with WebSocket hot-reload. `dev` is an alias for `preview`.

```
diagramify preview [--file <path>] [--port <n>] [--theme <t>] [--open]
diagramify dev    [--file <path>] [--port <n>] [--theme <t>] [--open]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--file <path>` | — | Watch a `.mmd` file and hot-reload on every save |
| `--port <n>` | `3000` | HTTP server port (WebSocket on port+1) |
| `--theme <t>` | `light` | Diagram theme |
| `--open` | — | Open browser automatically |

```bash
diagramify dev --file diagram.mmd --open
```

POST Mermaid source to `/api/update` to update the diagram programmatically. Hot-reload is broadcast to all open browser tabs.

Keyboard shortcuts in the interactive HTML viewer:

| Key | Action |
|-----|--------|
| `T` | Cycle themes (light → dark → Tokyo Night → Nord → Catppuccin) |
| `E` | Toggle edit mode (click any label to rename) |
| `L` | Toggle legend / sidebar |
| `H` | Toggle edge visibility |
| `R` | Reset zoom and pan |
| `G` | Toggle snap-to-grid |
| `F` | Fullscreen |
| `/` | Focus node search |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `Ctrl+C` / `Ctrl+V` | Copy / paste node |
| `Del` / `Backspace` | Delete selected node or edge |

---

### `diagramify watch`

Lightweight `.mmd` file watcher — HTTP server + WebSocket hot-reload only. No Express dependency.

```
diagramify watch <file> [--port <n>] [--theme <t>] [--open] [--outdir <dir>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--port <n>` | `3001` | HTTP port |
| `--theme <t>` | `light` | Diagram theme |
| `--open` | — | Open browser automatically |
| `--outdir <dir>` | — | Also write output files on each change |

```bash
diagramify watch diagram.mmd --open --theme dark
```

---

### `diagramify check`

Compares the committed diagram against the code, and reports what changed.

The check runs on the architecture graph, not on an image, so it names the
services that were added, removed, or rewired. It uses the analyzer by default,
so it needs no API key and runs on any build agent.

```bash
# Create the baseline, and commit it
diagramify check --update

# Fail the build when the code and the diagram disagree
diagramify check
```

| Flag | Purpose |
|------|---------|
| `--path <dir>` | Codebase root (default: current directory) |
| `--baseline <file>` | Committed graph to compare against (default: `diagrams/architecture.json`) |
| `--update` | Write the current graph to the baseline instead of comparing |
| `--llm` | Use the configured provider instead of the analyzer |
| `--json` | Print the report as JSON |

The command exits with code `1` when the diagram has drifted, which fails a CI
step. Example output:

```text
The diagram no longer matches the code.

Services added (2)
  + Kafka
  + Amazon S3

Services removed (1)
  - Redis

Run "diagramify check --update" and commit diagrams/architecture.json to accept the change.
```

---

### `diagramify diff`

Compare two Mermaid files and render a visual diff.

```
diagramify diff <old.mmd> <new.mmd> [--out html,svg] [--outdir <dir>]
```

```bash
diagramify diff v1/diagram.mmd v2/diagram.mmd --out html
```

Green = added, red = removed, grey = unchanged.

---

### `diagramify ci`

Generate a CI workflow that auto-regenerates diagrams on push.

```
diagramify ci <github|gitlab|precommit> [--outdir <dir>]
```

```bash
# GitHub Actions
diagramify ci github --outdir diagrams

# Pre-commit hook
diagramify ci precommit
```

---

### `diagramify init`

Scaffold a `diagramify.config.ts` in the current directory.

```bash
diagramify init
```

---

## Configuration

### Environment variables

```bash
# LLM providers (set at least one)
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GOOGLE_GENERATIVE_AI_API_KEY=...

# Defaults (optional)
export DIAGRAMIFY_PROVIDER=google
export DIAGRAMIFY_MODEL=gemini-flash-latest
export DIAGRAMIFY_THEME=dark
```

### Config file (`diagramify.config.ts`)

```typescript
import type { DiagramifyConfig } from 'diagramify-ai';

export default {
  provider: 'google',
  model: 'gemini-flash-latest',
  theme: 'tokyo-night',
  defaultOutput: ['html', 'svg'],
  temperature: 0.7,
  maxTokens: 8192,
} satisfies DiagramifyConfig;
```

---

## API Reference

### `generateDiagram(options)`

```typescript
import { generateDiagram } from 'diagramify-ai';

const result = await generateDiagram({
  input: 'codebase',          // or 'description'
  path: './src',              // codebase root
  // description: '...',      // alternative to path
  diagramType: 'flowchart',  // or 'auto'
  config: { provider: 'anthropic' },
});

result.mermaid     // string — Mermaid source
result.svg         // string | undefined
result.html        // string | undefined — full interactive HTML
result.png         // Buffer | undefined
result.jpeg        // Buffer | undefined
result.tokensUsed  // number | undefined
```

### `renderDiagram(source, formats, options?)`

```typescript
import { renderDiagram } from 'diagramify-ai';

const result = await renderDiagram(mermaidSource, ['svg', 'html', 'png'], {
  theme: 'dark',
  width: 1600,
});
```

### `analyzeCodebase(rootPath, maxFiles?)`

```typescript
import { analyzeCodebase } from 'diagramify-ai';

const analysis = await analyzeCodebase('./');
analysis.summary       // text summary for LLM prompt
analysis.frameworks    // ['nextjs', 'postgresql', 'redis', ...]
analysis.entryPoints   // main entry files detected
```

---

## React component

```tsx
import { DiagramViewer } from 'diagramify-ai/react';

export default function MyPage() {
  return (
    <DiagramViewer
      mermaidSource={mermaidString}
      theme="dark"
      height={600}
    />
  );
}
```

---

## Diagram types

| Type | Best for |
|------|----------|
| `flowchart` | Architecture, system components, data flow |
| `sequence` | API calls, request/response flows |
| `class` | Data models, ORM schemas, class hierarchies |
| `er` | Database entity-relationship diagrams |
| `state` | State machines, workflow steps |
| `auto` | Let the LLM decide based on context |

---

## LLM Providers

| Provider | Env var | Default model |
|----------|---------|---------------|
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6` |
| `openai` | `OPENAI_API_KEY` | `gpt-4o` |
| `google` | `GOOGLE_GENERATIVE_AI_API_KEY` | `gemini-flash-latest` |

> **Google Gemini note:** Use `gemini-flash-latest` or `gemini-2.0-flash` for codebase generation. The older `gemini-1.5-*` model IDs are no longer available on the v1beta API. Diagramify disables thinking budget on all Google models to ensure the full token budget goes toward Mermaid output.

---

## Architecture

```
diagramify/
├── src/
│   ├── core/
│   │   ├── types.ts       # Shared types and interfaces
│   │   ├── config.ts      # Config file loading
│   │   ├── provider.ts    # Vercel AI SDK abstraction
│   │   ├── analyze.ts     # Codebase structure analysis
│   │   ├── generate.ts    # LLM orchestration + validation
│   │   ├── render.ts      # SVG / PNG / JPEG rendering
│   │   ├── html.ts        # Interactive HTML overlay generator
│   │   ├── diff.ts        # Diagram diffing
│   │   └── ci/            # CI workflow generators
│   ├── cli/               # CLI command handlers
│   ├── icons/             # Service icon resolution
│   └── react/             # React component
├── skills/
│   └── diagramify/
│       └── SKILL.md       # Claude Code skill
```

---

## How it works

1. **Analyze** — scan codebase structure (files, imports, frameworks, entry points) — or accept a text description
2. **Prompt** — build a structured LLM prompt with context and diagram rules (intra-module wiring, no floating nodes)
3. **Generate** — call Claude / OpenAI / Gemini to produce valid Mermaid syntax
4. **Validate** — parse and verify output; retry up to 3× on failure
5. **Render** — convert to SVG using `beautiful-mermaid` (pure TypeScript, no DOM)
6. **Overlay** — optionally wrap SVG in interactive HTML with icons, drag-and-drop, themes, orthogonal edge routing
7. **Rasterize** — optionally convert SVG to PNG / JPEG via `sharp`

---

## Security

Diagramify uses the Vercel AI SDK for LLM calls. There are known transitive vulnerabilities in `@ai-sdk/provider-utils` (Uncontrolled Resource Consumption) and `jsondiffpatch` (XSS via HTML formatter). These are **not exploitable** via the CLI or library API surface — no untrusted JSON is passed to jsondiffpatch and the provider-utils vulnerability requires an attacker-controlled server response in a streaming context the CLI does not use.

Run `npm run audit:prod` to check current production vulnerability status. See [SECURITY.md](./SECURITY.md) for the full vulnerability register and workaround guidance.

---

## Open source

Diagramify is open-source software released under the [MIT License](./LICENSE).
You can use, modify, distribute, and contribute to it. See
[CONTRIBUTING.md](./CONTRIBUTING.md), [SECURITY.md](./SECURITY.md), and the
[Code of Conduct](./CODE_OF_CONDUCT.md) before participating.

## Contributing

Issues and pull requests are welcome at
[github.com/BabalolaBrainiac/diagramify](https://github.com/BabalolaBrainiac/diagramify).
Run `npm run check` before submitting a change.

When filing a bug, use the GitHub Issue templates — they include structured fields for reproducing diagram quality issues, missing icons, analyzer misses, and rendering bugs.

## Acknowledgments

- [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid) — pure TypeScript Mermaid rendering
- [Vercel AI SDK](https://sdk.vercel.ai) — multi-provider LLM abstraction
- [Mermaid](https://mermaid.js.org) — diagram syntax and tooling
