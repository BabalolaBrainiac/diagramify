# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

## [0.4.0] — 2026-09-10

### Added

- Optional local Ollama models without provider keys or automatic model downloads.
- Caller engine interfaces and a `generate --prepare` to `render --request` workflow.
- Graph documents that preserve evidence, descriptions, identifiers, and saved geometry.
- Source evidence and keyboard access in the component detail panel.
- Browser interaction tests and a repeatable rendering benchmark.
- Atomic graph operations, revision checks, and complete undo for browser and agent edits.
- A shared local preview API for browser edits and agent operations.
- React change callbacks and browser bundle tests.
- Keyboard support for legend filter controls, and for renaming a focused node while in edit mode.
- Browser test coverage for the router's obstacle avoidance during a drag, and for group boundaries staying correct after a member is dragged.

### Changed

- Codebase generation uses source analysis when no model credentials are available.
- Model prompts request supported additions without minimum node counts or compulsory connections.
- Source findings survive model proposals. Invalid references fail validation.
- Nested package dependencies retain their module ownership and source paths.
- Generic database libraries no longer imply PostgreSQL.
- Dragging reuses connection elements and avoids browser path measurements.
- HTML and image exports share one Mermaid layout.
- Preview updates retain the page, viewport, filters, and independent local edits.
- Preview and watch use one HTTP port, with WebSocket updates at `/updates`.
- React source updates retain the iframe and its graph history.
- Mermaid editing uses the renderer parser for chained connections, groups, and arrows in both directions.
- PNG and JPEG export of large diagrams (250+ nodes) is about 15 times faster; shadow filters are now bound to each shape instead of the whole page.
- Checking only whether the graph changed no longer clones the full graph; reading the graph itself still does.
- The router's obstacle checks during a drag now use a spatial index instead of scanning every node in the diagram.

### Fixed

- Edge routes no longer cut through an unrelated node's card. The router now tries a wider detour and checks the full path against every node, not only its own crossing point.
- Edge labels no longer overlap node cards. Label placement now reserves node space, not only space already used by other labels.
- SVG export now matches the live viewer's edge width, dash pattern, and label size, instead of using default values.
- A node's label is no longer lost when an edge in the Mermaid source references that node before the node's own label declaration.
- The legend now lists only the service types present in the diagram, and its list stays in sync with types added or changed during live editing.
- Dimmed nodes, from search or a legend filter, keep readable contrast in both themes instead of fading toward the page background.
- The toolbar no longer overflows the window below about 900px wide.

## [0.3.0] — 2026-09-04

### Added

**The Architecture IR.** One typed graph now sits between analysis and output.
Before this, the pipeline built a structured analysis, flattened it to English
prose, asked a model to rebuild it as Mermaid text, then repaired the text with
regular expressions. Structure was built, discarded, and guessed back.

- `src/core/ir.ts`: the `ArchitectureGraph` type, a schema for constrained model
  output, repair for malformed model output, and stable serialization.
- `src/core/ir-analyzer.ts`: builds the graph from a codebase with no model.
- `src/core/ir-mermaid.ts`: converts between the graph and Mermaid, both ways.
- `src/core/ir-layout.ts`: lifts geometry from a rendered SVG back into the graph.
- `generate` now asks the model to fill the schema. Free-text Mermaid remains
  only as a fallback for a provider that cannot do it.

**Zero-provider mode.** `--no-llm` builds the diagram from the codebase alone.
No API key, no network, and no cost. It maps a real .NET service to 21 nodes.

**New output formats.** `pdf`, `drawio`, `excalidraw`, and `json`, on both
`render` and `generate`.

- The PDF is true vector, with selectable text and real arrowheads. It uses the
  base PDF fonts, so nothing is embedded and no headless browser is needed.
- `drawio` and `excalidraw` keep the rendered layout, so a reviewer can correct
  the diagram in a tool they already run.
- `json` writes the graph itself, which the drift gate compares.

**Drift gate.** `diagramify check` compares the committed graph against the code
and exits non-zero when they differ. It reports the services added, removed, and
rewired, because it compares the graph and not an image.

**Offline mode.** `--offline` produces one HTML file that makes no network
request at all. `offlineMode` was declared in the types before this and did
nothing.

**Deep architecture evidence.** The analyzer now scans nested deployment files,
internal modules, endpoints, workers, jobs, imports, and service calls.

- Direct service links keep their source component and connection type.
- Nested Serverless systems now supply Lambda, storage, event, and workflow facts.
- Earlybird analysis now includes Kinde and its confirmed endpoint links.

**Viewer controls.** A user can hide a node, group, or connection without deleting it.
The hidden item panel can restore one item or all items.

**Theme exports.** The HTML viewer can export PNG, JPEG, SVG, and PDF in light or dark mode.

**Bundled icons.** The package now includes its icon data and makes no icon network request.
It uses exact product icons, platform icons, semantic icons, then initials.
Dark brand icons gain contrast automatically on every dark theme.

- `--background <color>` on `render` and `generate`. Use `transparent` to keep
  the alpha channel.
- Regression coverage for the IR, drift, layout, all exporters, raster fidelity,
  and the viewer. The suite went from 113 to 252 tests.

**Provider and model discovery.** One key is now all a user supplies. The
provider is chosen from whichever key is set, and the model is read from the
provider's own list rather than pinned in this package.

- `src/core/models.ts`: provider detection, model discovery, ranking, and a
  one-day cache.
- `diagramify models` reports the provider and the model each tier resolves to,
  before a token is spent.
- `--tier fast|balanced|best` says how much capability to ask for.
- `--model` pins an exact model. `--no-discover` skips the lookup.
- A failed lookup falls back to a built-in name and says why, rather than
  stopping the run.

### Changed

- Edge labels keep their full text. They sit above their lines and avoid other labels.
- Repeated `uses` and `routes` labels appear on hover, which reduces default clutter.
- The offline graph uses confirmed component links before it adds general service links.
- The PDF receives the deeper graph and preserves its vector layout in both themes.

- The viewer loads no third-party script. Pan and zoom, and the raster export,
  are now built in. Both used to come from a CDN.
- The viewer's SVG export writes real shapes and text. It used to wrap each card
  in an embedded HTML object, which only a browser could draw, so the file
  opened as an empty box in Illustrator, Figma, and Inkscape.
- Upgraded the Vercel AI SDK from v4 to v7, and every `@ai-sdk` provider v1 to v4.
- Upgraded `sharp` to 0.35, `express` to 5, `vitest` to 4, and `np` to 12.
- Migrated ESLint to version 9 and a flat config at `eslint.config.js`.
- `npm run check` now also runs `npm run audit:prod`, so a production advisory
  fails the build.
- Improved .NET/C# analysis for `Program.cs`, `.csproj` dependencies, module
  directories, minimal API endpoints, Docker Compose services, and
  project-reference links.
- `diagramify render` validates requested output formats and can write `.mmd`.
- `diagramify preview` and `dev` support WebSocket hot reload for `.mmd` files.

### Fixed

- **Every raster export was unreadable.** A rasterizer cannot read CSS `var()`
  or `color-mix()`, so all node, edge, and text colors fell back to black.
  Colors now resolve to literals before rasterizing.
- **Node labels were covered by an outline.** The `.node` rule set a stroke on
  the group, which every label glyph inherited. At 13px text a 1.5px outline hid
  the letters. The rule now targets shape children only.
- **The minimap and the node detail panel never worked.** Both were declared
  after the script that wires them, so the lookup returned null and each feature
  was silently dead.
- **Fit-to-content never zoomed in.** A hard cap of 1 left a small diagram
  stranded in a large empty canvas.
- **A cylinder node had no label.** The Mermaid parser pattern for `id[(label)]`
  had no capture group for the label.
- PNG and JPEG exports no longer have a transparent background, which made a
  dark theme unreadable on a light page.
- JPEG export flattens onto the theme background, because JPEG holds no alpha.
- `RenderOptions.backgroundColor` was declared but never used.
- An unpinned CDN script let the host change code inside a diagram that had
  already been shared. Every CDN script is now gone.
- The analyzer drew one node per spelling of a service, so `redis`, `Redis`, and
  a compose entry became three nodes. It now draws one.
- The analyzer no longer draws a health-check package as an architecture
  component, and no longer writes "Postgre SQL" for "PostgreSQL".
- The Excalidraw export anchored every arrow to the left and right edges, which
  drew long diagonals across a top-down diagram. Arrows now follow the route the
  renderer drew.
- An editable export taken on its own kept no layout, because the SVG render was
  skipped.
- Removed all emoji from CLI output.
- HTML viewer: initial load scales and pans to fit the content.
- HTML viewer: undo and redo capture full DOM state.
- HTML viewer: grid snap applies on a normal drag `pointerup`.
- HTML viewer: layer toggles work through injected `data-subgraph` attributes.

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
