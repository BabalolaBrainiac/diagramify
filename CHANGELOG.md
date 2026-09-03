# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- `--background <color>` on `diagramify render` and `diagramify generate`. Use `transparent` to keep the alpha channel.
- A color flattener at `src/core/styling/flatten.ts`. It resolves `var()` and `color-mix()` to literal colors before rasterizing.
- An opaque theme background rectangle in every SVG, so PNG and JPEG exports are not transparent.
- Regression coverage for raster fidelity: color resolution, background, contrast, and text stroke.
- Regression coverage for .NET codebase analysis and nonblank PNG raster output
- `diagramify dev` alias command for the interactive dev server workflow
- `--open` flag for `diagramify watch` to auto-launch the browser
- GitHub Issue templates for bug tracking and quality misses

### Changed
- Upgraded the Vercel AI SDK from v4 to v7, and every `@ai-sdk` provider from v1 to v4.
- Upgraded `sharp` to 0.35, `express` to 5, `vitest` to 4, and `np` to 12.
- Migrated ESLint to version 9 and a flat config at `eslint.config.js`.
- `npm run check` now also runs `npm run audit:prod`, so a production advisory fails the build.
- `SECURITY.md` now records zero production advisories, plus the remaining development-only ones.
- Improved .NET/C# analysis for `Program.cs`, `.csproj` dependencies, module directories, minimal API endpoints, Docker Compose services, and project-reference links
- `diagramify render` now validates requested output formats and can write `.mmd` output explicitly
- `diagramify preview` (and `dev`) now support full WebSocket hot-reload for `.mmd` file watching

### Fixed
- **Every raster export was unreadable.** A rasterizer cannot read CSS `var()` or
  `color-mix()`, so all node, edge, and text colors fell back to black. Colors now
  resolve to literals before rasterizing.
- **Node labels were covered by an outline.** The `.node` rule set a stroke on the
  group, which every label glyph inherited. The rule now targets shape children only,
  and label text sets `stroke: none`.
- PNG and JPEG exports no longer have a transparent background, which made a dark theme unreadable on a light page.
- JPEG export now flattens onto the theme background, because JPEG holds no alpha channel.
- `RenderOptions.backgroundColor` was declared but never used. It now reaches the SVG and both raster formats.
- Removed all emoji from CLI output.
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
