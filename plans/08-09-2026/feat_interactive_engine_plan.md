# Interactive diagram engine

The user approved implementation on 8 September 2026.
The user also requested better architecture analysis and optional models without required API keys.

## Product requirements

- Agents and people must share one diagram document.
- Updates must preserve the current selection, view, and edits.
- Architecture claims must identify their evidence or uncertainty.
- Diagramify must control graph validation, layout, and rendering.
- Codebase analysis and rendering must work without a model or hosted service.
- A caller can supply a graph or an optional interpretation engine.
- Optional local inference must use an installed model. It must not download a model automatically.
- Existing Mermaid inputs and exports must remain usable.

## Implementation sequence

1. Establish evidence-based architecture generation and complete graph saving.
2. Add keyless analysis, optional local inference, and a caller engine interface.
3. Remove repeated layout and browser path measurements.
4. Add graph operations, revision checks, and complete undo.
5. Replace page reloads with updates that preserve user state.
6. Improve dependency inspection, layout controls, and keyboard access.
7. Verify browser interaction, exports, architecture accuracy, and performance.

## Current decisions

- Keep model interpretation separate from deterministic rendering.
- Keep hosted model providers optional.
- Use Ollama for optional local interpretation.
- Keep evidence from source analysis when a model proposes additional structure.
- Remove prompt requirements for minimum node counts and compulsory connections.
- Keep unknown ownership visible. Do not attach every dependency to the first module.
- Compare the current viewer with alternative renderers before replacing its rendering framework.
- Keep hosted collaboration outside the initial runtime requirements.

## Verification

- Test graph validation, complete saving, and compatibility with existing documents.
- Test evidence ownership, unsupported claims, and isolated components.
- Test local inference with controlled responses, timeouts, and invalid output.
- Test caller engines without provider credentials or network access.
- Test layout reuse and export fidelity.
- Use real browser input for performance measurements.
- Run `npm run check`.
- Report local model availability separately from model quality measurements.

## Git and recovery

The current branch is `feat/architecture-ir-and-provider-autodetect`.
The working tree was clean before this work.
Do not change Git state without fresh permission.
Keep changes in ordinary project files for review.

## Implementation status

The changes deliver source evidence, optional engines, faster rendering, graph editing, and shared live updates.

| Work | Status |
|---|---|
| Source paths, dependency ownership, and claim status | Implemented |
| Keyless analysis, local Ollama adapter, and caller proposals | Implemented |
| Complete graph fields and saved node positions | Implemented, including browser connection and group edits |
| Shared layout and incremental connection rendering | Implemented |
| Source inspection and node keyboard access | Implemented |
| Graph operations, revision checks, and complete undo | Implemented |
| State preservation during live updates and React embedding | Implemented |
| Language parsers and architecture accuracy evaluation | Pending |
| Local model comparison and default model selection | Pending |

## Verified results

- `npm run check`: lint, types, 304 unit tests, and build passed on 9 September 2026.
- The audit step could not reach the registry inside the sandbox.
- `npm run audit:prod` passed with registry access and reported zero vulnerabilities.
- Chrome passed 22 browser and integration tests, including React, concurrent edits, reconnection, conflicts, and atomic file saves.
- `npm pack --dry-run --json --ignore-scripts` included the new public APIs and workflow documents.
- `git diff --check` passed.
- The browser benchmark measured 120 nodes and 195 connections across 30 drag steps.
- The latest 95th-percentile redraw time fell from 31.9 ms to 1.7 ms.
- This duration covers connection and minimap work. It excludes browser painting and model inference.

The Ollama executable is installed, but its server was stopped during validation.
Controlled responses verify the adapter contract. They do not measure live model accuracy or latency.
CLI image exports still apply automatic layout to imported graph documents.
The viewer and editable exports retain saved node positions.

See `docs/engines.md`, `docs/live-editing.md`, and `docs/performance.md` for workflows and measurement details.
