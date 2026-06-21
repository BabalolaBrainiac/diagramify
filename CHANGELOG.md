# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Regression coverage for .NET codebase analysis and nonblank PNG raster output
- `diagramify dev` alias command for the interactive dev server workflow
- `--open` flag for `diagramify watch` to auto-launch the browser
- GitHub Issue templates for bug tracking and quality misses

### Changed
- Improved .NET/C# analysis for `Program.cs`, `.csproj` dependencies, module directories, minimal API endpoints, Docker Compose services, and project-reference links
- `diagramify render` now validates requested output formats and can write `.mmd` output explicitly
- `diagramify preview` (and `dev`) now support full WebSocket hot-reload for `.mmd` file watching
- `SECURITY.md` now tracks known transitive AI SDK vulnerabilities with workaround guidance

### Fixed
- PNG/JPEG raster exports no longer render as all-black images when SVG theme styles use CSS variables
- Unsupported CLI output formats now fail loudly instead of exiting successfully without writing files
- HTML Viewer: Initial diagram load now scales and pans to perfectly fit-to-content
- HTML Viewer: Minimap now renders live nodes via canvas instead of relying on broken SVG clones
- HTML Viewer: Undo/Redo now captures full DOM state, properly reverting structural changes
- HTML Viewer: Grid snap now applies correctly on normal drag `pointerup`
- HTML Viewer: Layer toggles now work via injected `data-subgraph` attributes

## [0.2.1] — 2026-06-11

### Added
- GitHub Actions CI across Node.js 18, 20, and 22
- Dependabot, issue templates, pull request template, contribution guide, security policy, and code of conduct
- Release-readiness regression coverage and production dependency audit command

### Changed
- Marked package metadata and documentation explicitly as open source
- Corrected npm package references and pinned `beautiful-mermaid`
- Hardened interactive HTML generation against script injection

### Fixed
- Provider-specific default model selection
- Class, ER, state, and directive-prefixed flowchart detection
- Non-flowchart generation being incorrectly forced or rewritten as flowcharts
- `diagramify diff --out svg` output and missing output-directory creation
- CLI and package version mismatches

---

## [0.2.0] — 2026-06-10

### Added
- **Interactive HTML output** (`--out html`) — Fully interactive diagram viewer with:
  - Drag-and-drop nodes and subgraph containers
  - Pan (drag background) and scroll-to-zoom
  - Light / dark / Tokyo Night / Nord / Catppuccin themes (press `T` to cycle)
  - Edit-mode label editing (`E` to toggle, then click any label)
  - Node search sidebar (`/` to focus)
  - Export to PNG (4×), SVG, JPEG, `.mmd` from the browser
  - Delete nodes/edges with `Backspace` / `Delete`
  - Mini-map viewport indicator
  - Node detail panel (click any node)
  - Edge highlighting on click/hover
- **`diagramify preview`** command — hot-reloading browser preview server for `.mmd` files
- **`diagramify diff`** command — compare two `.mmd` files and render a diff HTML/SVG showing added/removed nodes and edges
- **`diagramify ci`** command — generate GitHub Actions or GitLab CI workflows that auto-regenerate diagrams on push
- **React component** (`import { DiagramViewer } from 'diagramify-ai/react'`) — embed the interactive viewer in React apps
- **Expanded icon system** — 200+ service icons with brand-accurate colors (AWS, GCP, Azure, databases, messaging, DevOps, AI/ML, etc.)
- **Deeper codebase analysis** — internal dependency graph detection for monorepos; identifies entry points, frameworks, and inter-service connections
- **`html` format** added to `generateDiagram()` and `renderDiagram()` return types

### Changed
- Arrow markers redesigned — slim open-chevron style, no longer overlapping box edges
- Node cards are now compact horizontal rows (icon + label) for much less visual clutter
- Subgraph labels are larger and full-color for clarity
- Unknown service names now produce a branded initials-based data-URI SVG rather than a CDN fallback that could 404

### Fixed
- Ghost nodes being dragged after deletion (was caused by stale `containedNodes` references to detached DOM elements)
- `editMode` keydown listener firing before the variable was declared
- SVG edge regex failing on multi-line `beautiful-mermaid` output
- TypeScript strict null error in `extractFromSVG` edge-label loop

---

## [0.1.0] — 2026-06-07

### Added
- Initial release
- `diagramify generate` — analyze a codebase or description and produce Mermaid diagrams
- `diagramify render` — render an existing `.mmd` file to SVG, PNG, or JPEG
- `diagramify init` — scaffold a `diagramify.config.ts`
- LLM-agnostic via Vercel AI SDK: Anthropic, OpenAI, Google Gemini
- Pure-TypeScript SVG rendering via `beautiful-mermaid` (no Puppeteer / headless browser)
- PNG and JPEG rasterization via `sharp`
- Claude Code skill in `skills/`
- React component (`diagramify-ai/react` subpath)
