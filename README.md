# diagramify

AI-powered Mermaid diagram generator. Analyzes codebases or descriptions and generates architecture, flowchart, sequence, class, ER, and state diagrams. Renders to SVG, PNG/JPEG, and Mermaid source. Works as a CLI tool, npm library, and Claude Code skill.

## Features

- **Codebase analysis** — Automatically analyze your project structure and generate architecture diagrams
- **Natural language input** — Describe your system and let Claude generate the diagram
- **Multiple output formats** — SVG, PNG, JPEG, and raw Mermaid source
- **LLM-agnostic** — Works with Claude, OpenAI, or Google Gemini
- **CLI tool** — `diagramify generate`, `diagramify render`, `diagramify init`
- **npm library** — Import and use programmatically in your Node.js projects
- **Claude Code skill** — Invocable via slash command or natural language in Claude Code
- **No browser required** — Pure TypeScript rendering, no Puppeteer or Chromium

## Installation

### As a CLI tool

```bash
npm install -g diagramify
```

### As an npm library

```bash
npm install diagramify
```

### Claude Code skill

Copy `skills/diagramify/SKILL.md` to `~/.claude/skills/diagramify/SKILL.md`:

```bash
mkdir -p ~/.claude/skills/diagramify
cp skills/diagramify/SKILL.md ~/.claude/skills/diagramify/
```

## Quick start

### Generate a diagram from your codebase

```bash
diagramify generate --path . --type auto --out svg,png,mmd
```

This will analyze your codebase and generate:
- `diagram.svg` — Scalable vector diagram
- `diagram.png` — Rasterized PNG (1200px wide)
- `diagram.mmd` — Raw Mermaid source code

### Generate a diagram from a description

```bash
diagramify generate --description "Microservices with API gateway, auth service, and database" --type flowchart --out svg
```

### Render an existing .mmd file

```bash
diagramify render mydiagram.mmd --out png,svg
```

### Use as an npm library

```typescript
import { generateDiagram, analyzeCodebase } from 'diagramify';

// Generate from codebase
const result = await generateDiagram({
  input: 'codebase',
  path: './src',
  diagramType: 'flowchart',
  config: { provider: 'anthropic' },
});

console.log(result.svg);     // SVG string
console.log(result.png);     // PNG buffer
console.log(result.mermaid); // Mermaid source code
```

## Configuration

### Environment variables

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export DIAGRAMIFY_PROVIDER=anthropic
export DIAGRAMIFY_MODEL=claude-sonnet-4-6
export DIAGRAMIFY_THEME=default
```

### Config file

Create `diagramify.config.ts` in your project root:

```typescript
import type { DiagramifyConfig } from 'diagramify';

export default {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  theme: 'tokyo-night',
  defaultOutput: ['svg', 'png', 'mmd'],
  temperature: 0.7,
  maxTokens: 4096,
} satisfies DiagramifyConfig;
```

Or use `diagramify init` to scaffold a config file.

## CLI Reference

### diagramify generate

Analyze a codebase or description and generate a diagram.

```bash
diagramify generate [options]
```

**Options:**

- `--path <dir>` — Codebase root directory (default: current directory)
- `--description <text>` — Natural language description instead of codebase analysis
- `--type <type>` — Diagram type: `flowchart|sequence|class|er|state|auto` (default: `auto`)
- `--out <formats>` — Output formats: `svg,png,jpeg,mmd` (default: `svg,mmd`)
- `--outdir <dir>` — Output directory (default: current directory)
- `--name <name>` — Base filename for outputs (default: `diagram`)
- `--theme <theme>` — Diagram theme name
- `--provider <name>` — LLM provider: `anthropic|openai|google` (default: `anthropic`)
- `--model <id>` — Model ID override
- `--stdout` — Print Mermaid source to stdout instead of files
- `--json` — Output as JSON with base64-encoded images

**Examples:**

```bash
# Analyze current directory as flowchart
diagramify generate --type flowchart --out svg,png

# Generate sequence diagram from description
diagramify generate --description "User logs in, auth service validates, returns token" --type sequence

# Use OpenAI instead of Claude
diagramify generate --provider openai --model gpt-4o
```

### diagramify render

Render an existing .mmd file to SVG, PNG, or JPEG.

```bash
diagramify render <input.mmd> [options]
```

**Options:**

- `--out <formats>` — Output formats: `svg,png,jpeg` (default: `svg`)
- `--outdir <dir>` — Output directory (default: same as input file)
- `--name <name>` — Output filename (default: `diagram`)
- `--theme <theme>` — Diagram theme
- `--width <px>` — Output width in pixels (default: `1200`)
- `--quality <1-100>` — JPEG quality (default: `90`)
- `--stdout` — Print SVG to stdout

**Examples:**

```bash
# Render to PNG at higher quality
diagramify render mydiagram.mmd --out png --width 1600

# Render from stdin and output to stdout
cat diagram.mmd | diagramify render - --out svg --stdout > output.svg
```

### diagramify init

Create a `diagramify.config.ts` in the current directory.

```bash
diagramify init
```

## Diagram types

| Type | Use case | Example |
|------|----------|---------|
| `flowchart` | System architecture, component connections | Microservices diagram |
| `sequence` | Request flows, API interactions | User login sequence |
| `class` | Data models, class hierarchies | ORM schema |
| `er` | Database schemas, entity relationships | Database diagram |
| `state` | State machines, workflows | Payment state machine |
| `auto` | Auto-detect best type | Let Claude choose |

## LLM Providers

### Anthropic (Claude)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
diagramify generate --provider anthropic --model claude-sonnet-4-6
```

Supported models:
- `claude-opus-4-1`
- `claude-sonnet-4-6`
- `claude-haiku-3-5`

### OpenAI

```bash
export OPENAI_API_KEY=sk-...
diagramify generate --provider openai --model gpt-4o
```

Supported models:
- `gpt-4-turbo`
- `gpt-4o`
- `gpt-3.5-turbo`

### Google Gemini

```bash
export GOOGLE_GENERATIVE_AI_API_KEY=...
diagramify generate --provider google --model gemini-2.5-flash
```

Supported models:
- `gemini-2.5-flash`
- `gemini-2.5-pro`
- `gemini-1.5-pro`

## Themes

Beautiful-mermaid themes available via `--theme`:
- `default`
- `dark`
- `light`
- `tokyo-night`
- `catppuccin-latte`
- `nord`
- `gruvbox`
- And 8+ more

## API Reference

### generateDiagram()

```typescript
async function generateDiagram(options: GenerateOptions): Promise<DiagramifyResult>
```

Generate a diagram from a codebase or description.

**Options:**

- `input: 'codebase' | 'description'` — Input type
- `path?: string` — Codebase root (for `input: 'codebase'`)
- `description?: string` — Text description (for `input: 'description'`)
- `diagramType?: DiagramType` — Diagram type (default: `auto`)
- `extraContext?: string` — Additional instructions
- `config?: DiagramifyConfig` — LLM and render config

**Returns:**

- `mermaid: string` — Raw Mermaid source
- `svg?: string` — SVG markup
- `png?: Buffer` — PNG image data
- `jpeg?: Buffer` — JPEG image data
- `diagramType: DiagramType` — Detected diagram type
- `tokensUsed?: number` — Tokens used by LLM

### renderDiagram()

```typescript
async function renderDiagram(
  mermaidSource: string,
  formats: OutputFormat[],
  options?: RenderOptions
): Promise<Omit<DiagramifyResult, 'tokensUsed'>>
```

Render Mermaid source to SVG/PNG/JPEG.

### analyzeCodebase()

```typescript
async function analyzeCodebase(rootPath: string, maxFiles?: number): Promise<AnalysisResult>
```

Analyze a codebase without LLM calls. Returns file structure, entry points, and language detection.

## Development

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

### Lint

```bash
npm run lint
```

### Type check

```bash
npm run typecheck
```

## Architecture

```
diagramify/
├── src/core/          # Core library
│   ├── types.ts       # Shared types
│   ├── config.ts      # Config loading
│   ├── provider.ts    # LLM abstraction (Vercel AI SDK)
│   ├── analyze.ts     # Codebase analysis
│   ├── generate.ts    # Orchestration
│   └── render.ts      # SVG/PNG/JPEG rendering
├── src/cli/           # CLI commands
├── skills/            # Claude Code skill
└── examples/          # Example .mmd files
```

## How it works

1. **Analyze** — Scan the codebase structure (or accept description)
2. **Prompt** — Build an LLM prompt with system rules and context
3. **Generate** — Call Claude, OpenAI, or Gemini to produce Mermaid syntax
4. **Validate** — Check the output is valid Mermaid; retry on failure
5. **Render** — Convert Mermaid to SVG using beautiful-mermaid
6. **Rasterize** — Optionally convert SVG to PNG/JPEG using sharp

## Why pure TypeScript rendering?

- **No browser** — beautiful-mermaid renders synchronously without DOM
- **No Chromium** — No 300MB+ installation
- **Fast** — SVG generation in milliseconds
- **Portable** — Works anywhere Node.js runs

## License

MIT — See LICENSE file

## Contributing

Contributions welcome! Please open issues or PRs on GitHub.

## Acknowledgments

- [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid) — Pure TypeScript Mermaid rendering
- [Vercel AI SDK](https://sdk.vercel.ai) — Multi-provider LLM abstraction
- [Mermaid](https://mermaid.js.org) — Diagram syntax and semantics
