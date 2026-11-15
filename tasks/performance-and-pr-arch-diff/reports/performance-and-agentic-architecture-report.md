# Diagramify Performance, Output Design, and Agentic Architecture Report

## 1. Executive Summary

This report documents the performance bottlenecks, optimization results, output design improvements, pull request architecture diff implementation, and agentic diagram concepts for `diagramify-ai`.

All measurements were collected locally on the updated repository and verified against the `ai-vm` codebase (`/Users/babalolaopeyemidaniel/Desktop/Workspace/opeyemi/rash/ai-vm`).

## 2. Measured Performance Improvements

| Metric | Baseline / Prior State | Updated Build | Change |
| --- | --- | --- | --- |
| Viewer runtime bundle (`src/viewer/session.generated.ts`) | `745,443 B` | `~255 KB` | ~66% smaller |
| Largest ESM chunk (`dist/chunk-*.js`) | `1.1 MB` | `583.36 KB` | ~47% smaller |
| CLI cold start (`diagramify --help`) | `151 - 155 ms` | `29.54 - 35.07 ms` | ~5x faster |
| `ai-vm` offline HTML output | `472,577 B` (`866,546 B` pre-split) | `421,228 B` | 10.9% vs Doc / 51.4% vs pre-split |
| `ai-vm` high-DPI PNG output | `615,501 B` | `304,475 B` | 50.5% smaller |
| Synthetic 60-node PNG render | `5,229.33 ms` (`460,819 B`) | `345.25 ms` (`32,634 B`) | 15.1x faster |
| Synthetic 150-node (`43460x1769`) PNG render | Crashed (`32767px` librsvg limit) | `417.31 ms` (`20,294 B`) | Crash fixed |
| All 9 formats on `ai-vm` (`render`) | — | `3,031.5 ms` | Full suite |
| Offline `generate --no-llm` on `ai-vm` (23 nodes) | — | `1,260.1 ms` (`0` tokens) | Full codebase |
| Pull request diff (`pr` across 178 files on `ai-vm`) | — | `1,296.2 ms` | Git snapshot + SVG/PNG/MMD |

## 3. Code, Setup, and Data-Structure Optimizations Implemented

### 3.1 Bundle Splitting and Startup Lazy Loading

- Split zero-dependency IR types and validation into `src/core/ir-types.ts` and `src/core/graph-validate.ts`. `src/core/graph-session.ts` no longer embeds `zod` into `src/viewer/session.generated.ts`.
- Enabled `splitting: true` in `tsup.config.ts` so CLI commands share lazy ESM chunks instead of duplicating code in `dist/cli/index.js` (`31.86 KB`).
- Moved heavy imports (`sharp`, `beautiful-mermaid`, `express`, `ws`, `ai`, `@ai-sdk/*`, `html.ts`) inside `.action()` handlers in `src/cli/commands/*.ts` and dynamically loaded `html.ts` inside `src/core/render.ts` only when `formats` includes `'html'`.
- Removed unused runtime dependency `"ignore"` from `package.json`.

### 3.2 Data Structures and Algorithmic Fixes

- **Icon and service registries** (`src/icons/services.ts`, `src/icons/simple-icons.ts`): Added `serviceLookupIndex` (`Map`) for `O(1)` service classification, `normalizedSlugIndex` (`Map`), and a bounded 512-entry `iconUrlCache`.
- **Single-walk repository scanner** (`src/core/analyze.ts`): Replaced redundant `fast-glob` walks across `parsePackageJsonDeps`, `parseDotnetDeps`, `detectServiceDirectories`, `findEndpointCandidateFiles`, and `traceDotnetProjectReferences` with one `scanRepoFiles` pass and a shared `fileCache`.
- **Parallel evidence collection** (`src/core/evidence.ts`, `src/core/ir-analyzer.ts`): Replaced sequential glob loops with `Promise.all`, added a capped `readCappedCached` promise cache, and replaced `O(N*M)` `.filter()` loops with `evidenceByComponent` and `evidenceByService` maps.
- **Graph layout and export loops** (`src/core/flowchart-layout.ts`, `src/core/ir-mermaid.ts`, `src/core/export/editable.ts`, `src/core/export/pdf.ts`, `src/core/styling/subgraph-fit.ts`): Replaced `queue.shift()` and linear `.includes()` / `.find()` scans with index cursors, `Set`, and `Map` lookups; replaced quadratic PDF string concatenation with buffered byte tracking; cached SVG attribute `RegExp` patterns; switched `subgraph-fit.ts` to single-pass `<rect>` replacement.
- **Viewer DOM reads** (`src/viewer/editor.ts`): Batched `offsetWidth` and `offsetHeight` measurements in `fitGroup` and `withInitialLayout` to reduce forced layout thrashing.
- **Raster pipeline safety and PNG encoding** (`src/core/render.ts`): Clamped SVG root dimensions before `librsvg` ingestion to stay within `32767px`, parallelized concurrent PNG and JPEG rasterization, and set PNG `compressionLevel: 6, effort: 4`.

## 4. Remaining Optimization Roadmap

1. **Pure Node/Rust Worker Layout Cache**: Persist ELK hierarchical layout hashes (`sha256` of normalized subgraph structure) in `.diagramify-cache/` for CI builds so unchanged PRs skip ELK layout calculation (`~80 ms` saved per run).
2. **Optional Light Dependencies**: Split `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, and `ai` behind optional peer dependencies or a `--lite` distribution for CI-only users who run `--no-llm`, `check`, and `pr`.
3. **Incremental Git Blob Reader**: Inside `runPrDiff`, parse `git cat-file --batch` streams directly in memory for changed manifests and state files instead of calling `git archive` + `tar` on very large monorepos (`> 10,000` tracked files).
4. **Shared Pre-flattened SVG Strings**: Reuse the `flattenSVGColors` result when exporting both `svg` and `pdf` in the same call.

## 5. Output Design and Copy Improvements

Guided by `PRODUCT.md`, `DESIGN.md`, and `impeccable` + `clean-copy` reviews:

- **Interactive HTML Viewer** (`src/core/html.ts`):
  - Replaced generic `Inter` font with `IBM Plex Sans` (`system-ui` fallback in `--offline` mode).
  - Removed the AI-style left accent border (`border-left: 3px`) on `.dfy-node` cards and replaced it with uniform structural borders plus tinted icon badges.
  - Added compact inline SVG icons to header toolbar buttons (`Legend`, `Edges`, `Hide`, `Edit`, `Theme`, `Auto-layout`), cleaner active states, and proper `30px x 30px` close control on `#dfy-detail-close`.
  - Tightened sidebar search alignment, removed redundant `"Interactions"` instructional rows and verbose em-dash labels, and constrained `.footer-tip` with blur surface separation so it does not crowd edge panels.
- **Static SVG and PNG Themes** (`src/core/styling/themes.ts`, `src/core/flowchart-layout.ts`):
  - Raised node-to-canvas contrast (`#FFFFFF` cards on `#F8FAFC` canvas in light mode; `#1E293B` on `#0F172A` in dark mode) with softer shadows and `rx="5"` card corners.
  - Scoped `.node > rect` and `.node text` theme CSS rules with `[fill^="var("]` and `:not([fill])` so Mermaid `classDef` fills (added green, modified amber, removed red) survive SVG and PNG styling.
- **Architecture Diff HTML** (`src/core/diff.ts`): Added light/dark theme variables, pill stat counters, responsive panel headers, and clean scrolling containers.

`impeccable detect --json src/core/html.ts src/core/diff.ts` returned `0` warnings after the final UI edits.

## 6. Pull Request Architecture and State-Machine Diff (`diagramify pr`)

`diagramify pr [prId]` (`src/core/pr-diff.ts`, `src/cli/commands/pr.ts`, GitHub Actions template in `src/core/ci/github.ts`) adds lightweight architecture visibility directly to pull request descriptions:

1. Resolves base and head commits via `gh pr view <prId>` or explicit `--base` / `--head` git refs.
2. Materializes lightweight committed snapshots via `git archive` (reusing the clean workspace when head matches `HEAD`).
3. Runs static architecture analysis (`analyzeCodebase` + `analysisToGraph` + `compareGraphs`) and state-machine delta extraction (`extractStateMachinesFromSources` + `diffStateMachines` over Mermaid `stateDiagram-v2` blocks, transition maps, and state enums).
4. Produces a focused, capped (`--max-nodes 24`) Mermaid diff graph (`flowchart LR` and optional `stateDiagram-v2`) with `+` added, `~` modified, and `-` removed styling.
5. Writes the Markdown summary idempotently into the PR body between `<!-- diagramify:pr-arch:start -->` and `<!-- diagramify:pr-arch:end -->` markers so repeated pushes update in place without noise, while leaving Mermaid blocks directly editable by reviewers.
6. Integrates automatically into `diagramify ci github` via the `pr-architecture-diff` job (`permissions: pull-requests: write`).

## 7. New Diagram Types and Ideas for Agentic Software Development

Modern AI-assisted development produces multi-agent workflows, tool boundaries, and rapid structural pull requests that static box-and-arrow diagrams do not capture. Recommended next-generation diagram modes for `diagramify`:

1. **PR Blast-Radius and State-Transition Diffs (Implemented)**: Highlight only added, changed, and removed services plus 1-hop neighbors alongside state enum and transition diffs directly inside PR bodies.
2. **Agent Topology and Delegation Maps**: Extract subagent definitions (`define_subagent`, CrewAI/LangGraph/AutoGen graphs), handoff edges, model tiers, and sandbox modes (`read-only`, `workspace-write`, `network-off`) into color-coded capability topologies.
3. **MCP, Tool, and Permission Boundary Diagrams**: Parse Model Context Protocol configs (`.mcp.json`, plugin manifests, IAM policies) to map which agent tools reach databases, networks, shells, or secrets—highlighting privilege boundaries during security review.
4. **Prompt and Context-Budget Allocation Charts**: Generate treemaps or stacked horizontal bars showing fixed vs dynamic token footprints across system prompts, skill instructions, file snippets, and tool schemas before context compaction triggers.
5. **State-Machine Invariant and Guard-Condition Charts**: Go beyond state names to extract guard predicates, timeouts, retry loops, and compensating cleanup paths (for example `SAVING` -> timeout -> `SAVE_FAILED`) as annotated swimlanes.
6. **Agent Execution Trace Swimlanes**: Convert `transcript.jsonl` / OpenTelemetry span traces into Mermaid `sequenceDiagram` artifacts showing parallel tool bursts, subagent wait states, retries, and latency hot spots inside CI test failures.
7. **Contract-Drift and Schema Impact Maps**: Diff OpenAPI/Pydantic/Zod schemas across PR commits to show broken consumers (`frontend/src/api/types.ts` <- `backend/app/views/schemas/`) next to endpoint changes.

## 8. Local `ai-vm` Verification Summary

Against `/Users/babalolaopeyemidaniel/Desktop/Workspace/opeyemi/rash/ai-vm`:

- **Static Render (`ai-vm/Docs/ai-vm-architecture-state-machine.mmd`)**: All 9 formats generated in `3,031.5 ms`. PNG size fell from `615,501 B` to `304,475 B` (`-50.5%`), HTML fell from `472,577 B` to `421,228 B` (`-10.9%`), and all orthographic routes and nested MVC tiers stayed legible.
- **Zero-LLM Codebase Mapping (`--no-llm`)**: Mapped `23` services, `17` source dependencies, and `18` inferred links in `1,260.1 ms` (`0` tokens used).
- **Historical Commit PR Diff (`6546547..d50d086`)**: Scanned `178` changed files in `1,296.2 ms`, identifying `+4` added endpoints, `~1` modified endpoint (`Volumes Endpoint`), and `-1` removed integration (`Cloudflare KV`) with preserved green, amber, and red `classDef` styling in SVG and PNG outputs.
