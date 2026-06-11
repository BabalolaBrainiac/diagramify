---
name: diagramify
description: Generate, revise, render, preview, compare, and automate Mermaid diagrams with Diagramify. Use when Codex needs to create architecture or flow diagrams from a repository or written system description; improve an existing .mmd diagram; render Mermaid to interactive HTML, SVG, PNG, or JPEG; compare diagram versions; configure Diagramify CI; or embed Diagramify through its Node.js or React APIs.
---

# Diagramify

Use Diagramify to produce evidence-based Mermaid diagrams and validated visual outputs. Treat the `.mmd` file as the editable source of truth.

## Choose The Workflow

- Generate from a repository when the user asks how a codebase is structured.
- Generate from a description when the user supplies the system or desired flow directly.
- Author or revise Mermaid manually when the user needs precise control or the generated diagram misses important evidence.
- Render when a `.mmd` source already exists and only visual outputs are needed.
- Preview while iterating interactively.
- Diff two flowchart `.mmd` files when the user asks what changed.
- Add CI only when the user asks for automated regeneration.
- Use the library or React API when integrating Diagramify into application code.

Read [references/cli.md](references/cli.md) for exact commands and flags. Read [references/api.md](references/api.md) for programmatic integration.

## Generate From A Codebase

1. Inspect the repository before generating:
   - Read the root manifest and relevant workspace manifests.
   - Locate entry points, service directories, deployment files, environment examples, and infrastructure definitions.
   - Identify real data stores, queues, external APIs, auth, observability, and service-to-service links.
2. Select the scope and diagram type:
   - Use `flowchart` for architecture and dependency views.
   - Use `sequence` for one request, event, or user journey.
   - Use `class` or `er` only when the code contains enough model/schema evidence.
   - Use `state` for explicit lifecycle transitions.
3. Generate into a dedicated output directory. Include `mmd` and at least one reviewable format, normally `html` or `svg`.
4. Open and inspect the generated `.mmd`. Correct unsupported claims, vague labels, missing major components, and unreadable structure.
5. Render the final `.mmd` again to validate syntax and outputs.

Use a focused path such as `apps/api` when the user asks about one subsystem. For large or unusual repositories, supplement generation with facts discovered during inspection; Diagramify's analyzer samples the codebase and cannot prove every runtime relationship.

## Generate From A Description

Convert the request into a concrete description before invoking Diagramify. Include:

- named actors and components;
- data stores, queues, and external systems;
- important protocols or payloads;
- trust boundaries or deployment groups;
- the exact flow or viewpoint the diagram should emphasize.

Choose a specific diagram type instead of `auto` when the request clearly implies one. Review and render-validate the generated `.mmd` before completion.

## Revise Or Author Mermaid

Follow [references/authoring.md](references/authoring.md) when editing Mermaid. Preserve stable node IDs during revisions so diffs remain meaningful.

Prefer multiple focused diagrams over one unreadable diagram. Do not invent infrastructure or interactions merely to make a diagram look complete. Mark inferred relationships clearly when they cannot be verified from source.

## Validate Before Completion

Always:

1. Confirm every important node and edge has evidence in the repository or user description.
2. Run `diagramify render` against the final `.mmd`.
3. Check that every requested output exists and is non-empty.
4. Report the source `.mmd`, generated outputs, scope, and any material inference or omission.

For visual review, prefer interactive HTML. Use SVG for deterministic, inspectable output. Add PNG/JPEG only when the user needs raster assets.

## Operational Rules

- Check whether `diagramify` is available before installing anything. Prefer the project's local dependency through `npx diagramify-ai`; use a global binary only when already installed.
- Generation requires an API key for the selected provider. Rendering, previewing, and diffing existing Mermaid do not require an LLM key.
- Never expose API-key values in commands, output, diagrams, or committed files.
- Keep generated artifacts in the user-requested location. Otherwise default to `diagrams/` with descriptive base names such as `system-context`, `request-flow`, or `data-model`.
- Do not overwrite an existing `.mmd` source unless the user requested revision. Use a new descriptive name or preserve the prior version for diffing.
- Avoid `--stdout` when the user expects files. It suppresses file writing for `generate` and `render`.
- Use `diagramify preview --open` only when opening a GUI is appropriate and permitted.

## Troubleshooting

Read [references/troubleshooting.md](references/troubleshooting.md) when generation or rendering fails, outputs are incomplete, or the generated architecture is inaccurate.
