# Diagramify Product Definition

## Purpose

Diagramify maps software repositories, service graphs, and state machines into architecture diagrams. It generates editable, self-contained outputs for local review, documentation, and pull requests.

## Target Users

- Software engineers reviewing system topology and state transitions.
- Platform and CI/CD pipelines validating architecture changes on pull requests.
- Coding agents inspecting and editing `ArchitectureGraph` IR documents without external network dependencies.

## Output Surfaces

1. Interactive HTML viewer (`src/core/html.ts`): single-file pan-and-zoom workspace with search, service legend filters, layer toggles, node detail drawer, inline label editing, and offline export.
2. Static SVG, PNG, JPEG, and PDF renders (`src/core/render.ts`, `src/core/flowchart-layout.ts`, `src/core/styling/`): publication-ready vector and high-DPI raster diagrams.
3. Architecture Diff and PR Summary (`src/core/diff.ts`, `src/core/pr-diff.ts`): side-by-side HTML diff views and compact Mermaid blocks for GitHub pull request descriptions.
