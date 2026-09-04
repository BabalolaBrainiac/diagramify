# Diagramify

[![npm version](https://badge.fury.io/js/diagramify-ai.svg)](https://badge.fury.io/js/diagramify-ai)
[![CI](https://github.com/BabalolaBrainiac/diagramify/actions/workflows/ci.yml/badge.svg)](https://github.com/BabalolaBrainiac/diagramify/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

> Open-source architecture mapping and rendering engine. Analyze a codebase or describe a system, then get a detailed architecture diagram.

Diagramify owns the architecture graph and rendering pipeline. It exports interactive HTML, images, PDF, editable files, JSON, and Mermaid source.

The package provides a CLI, an npm library, and an agent skill. Optional model support includes Anthropic, OpenAI, and Google.

---

## Features

- **Deep codebase analysis** — map nested systems, modules, endpoints, imports, service calls, and deployment evidence
- **Natural language input** — describe your system; a model refines the typed architecture graph
- **Interactive HTML output** — move, edit, search, filter, hide, restore, inspect, and export diagram elements
- **Fit-to-content on load** — large diagrams auto-scale to fill the viewport on open
- **Orthogonal edge routing** — edges draw as clean L/Z-shaped paths with rounded corners, not long diagonal arcs
- **Works with no LLM at all** — `--no-llm` builds the diagram from the codebase alone. No API key, no network, no cost
- **Typed architecture graph** — one IR that every renderer and exporter reads. A model fills a schema, so the result does not change with the provider
- **Multiple output formats** — `html`, `svg`, `png`, `jpeg`, `mmd`, `pdf`, `drawio`, `excalidraw`, `json`
- **Vector PDF** — real shapes and selectable text, not a picture. No dependency and no headless browser
- **Editable handoff** — `drawio` and `excalidraw` exports keep the layout, so a reviewer can correct the diagram in a tool they already run
- **Drift gate** — `diagramify check` fails a pull request when the diagram no longer matches the code, and names the services that changed
- **Theme-aware exports** — export PNG, JPEG, SVG, and PDF in light or dark mode from the viewer
- **Fully offline viewer** — `--offline` produces one HTML file that makes no network request
- **Diagram diffing** — `diagramify diff` compares two `.mmd` files and highlights changes
- **CI integration** — `diagramify ci` generates GitHub Actions / GitLab CI workflows
- **Hot-reload preview** — `diagramify preview` and `diagramify watch` serve and auto-reload on file changes via WebSocket
- **One key is all you need** — the provider is chosen from whichever key is set, and the newest suitable model is discovered from the provider itself, not pinned in this package
- **LLM-agnostic** — Claude, OpenAI, or Google Gemini, through schema-constrained output
- **React component** — embed the interactive viewer in any React app
- **No browser required** — pure TypeScript rendering, no Puppeteer

---

## Icon system

Diagramify uses one fixed icon order:

1. Use an exact bundled product icon.
2. Use the matching cloud platform icon.
3. Use a semantic icon for modules, APIs, workers, and authentication.
4. Use generated initials only when no other icon applies.

Aliases ignore case, spaces, dots, and hyphens. For example, `AWS S3` maps to Amazon S3.
The viewer embeds each icon in the HTML file. It does not request icons from a network.

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
| `diagramify models` | Show which provider and model a key resolves to | — | — |
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

> **Tip — Gemini on large codebases:** Use a non-thinking model when output is incomplete. Diagramify reserves the output budget for the architecture graph.

---

### `diagramify render`

Render an existing `.mmd` file to output formats.

```
diagramify render <input.mmd> [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--out <formats>` | `svg,html` | `html,svg,png,jpeg,mmd,pdf,drawio,excalidraw,json` |
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
| `H` | Hide the selected node, group, or connection |
| `Shift+H` | Restore all hidden elements |
| `R` | Reset zoom and pan |
| `G` | Toggle snap-to-grid |
| `F` | Fullscreen |
| `/` | Focus node search |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `Ctrl+C` / `Ctrl+V` | Copy / paste node |
| `Del` / `Backspace` | Delete selected node or edge |

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

### `diagramify models`

Shows which provider a key selects, and which model each tier resolves to. Run
it before `generate` to confirm the choice without spending a token.

```bash
diagramify models            # the choice for every key you have set
diagramify models --all      # also list every reachable model
diagramify models --refresh  # ignore the cached list and ask again
```

Example:

```text
Keys found for: google
Selected provider: google

google
  47 models reachable
    fast      gemini-flash-lite-latest
    balanced  gemini-flash-latest <- default
    best      gemini-pro-latest
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
export DIAGRAMIFY_TIER=best
export DIAGRAMIFY_THEME=dark
```

`GEMINI_API_KEY` also works in place of `GOOGLE_GENERATIVE_AI_API_KEY`.

**You do not have to name a provider or a model.** Set one key and Diagramify
works out the rest:

1. The provider is the one your key belongs to. `DIAGRAMIFY_PROVIDER` or
   `--provider` overrides it. With several keys set, the order is anthropic,
   openai, google.
2. The model comes from the provider's own model list, filtered to the models
   your key can reach. Diagramify prefers a stable build over a preview, a newer
   family over an older one, and a rolling alias over a dated snapshot.
3. `--tier fast|balanced|best` says how much capability to ask for. The default
   is `balanced`.
4. `--model` pins an exact model and skips the lookup. `--no-discover` skips the
   lookup and uses a built-in name.

The model list is cached for a day. `diagramify models --refresh` clears it.
This is why a new model from any provider works without upgrading this package.

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

> **Google Gemini note:** Diagramify disables thinking output. This keeps the complete output budget for the architecture graph.

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
│   │   ├── evidence.ts    # Deployment and environment evidence
│   │   ├── ir.ts          # Typed architecture graph
│   │   ├── ir-analyzer.ts # Offline graph construction
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

1. **Analyze** — scan files, imports, components, endpoints, deployment files, and service calls.
2. **Build** — create a typed architecture graph from confirmed evidence.
3. **Refine** — optionally let Claude, OpenAI, or Gemini improve the same graph.
4. **Validate** — repair and validate the graph before rendering.
5. **Render** — create SVG and preserve its layout in the graph.
6. **Export** — create HTML, images, PDF, editable formats, Mermaid, or JSON.

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
