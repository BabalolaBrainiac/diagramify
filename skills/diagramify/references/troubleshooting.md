# Diagramify Troubleshooting

## Command Not Found

Check the project-local binary first:

```bash
npx diagramify-ai --help
```

Install or modify dependencies only with user approval when the package is unavailable.

## Generation Fails Before Rendering

- Confirm the selected provider and its API-key environment variable.
- Confirm the model ID is valid for that provider.
- Retry with an explicit `--provider` and, if needed, `--model`.
- Reduce scope with `--path <subsystem>` when the repository is too broad.
- Generate from a curated `--description` when automated analysis cannot capture the required architecture.

Never print API-key values while diagnosing.

## Generated Diagram Is Inaccurate

- Compare nodes and edges against manifests, imports, routes, infrastructure, and environment examples.
- Remove invented services and unsupported relationships.
- Add missing facts manually to the `.mmd`, or regenerate from a precise description.
- Split mixed viewpoints into separate diagrams.
- Disclose any remaining inference.

## Mermaid Does Not Render

- Render the `.mmd` directly to get the concrete failure:

```bash
npx diagramify-ai render path/to/diagram.mmd --out svg --outdir /tmp --name validation
```

- Simplify unsupported Mermaid syntax.
- Use simple node shapes and stable alphanumeric or underscore IDs.
- Check subgraph `end` statements and edge syntax.
- Reduce the failing source to the smallest section, repair it, then restore content incrementally.

## Outputs Are Missing

- Ensure the requested format appears in `--out`.
- Do not combine file-output expectations with `--stdout`.
- Supply `--outdir` and `--name` explicitly.
- Check that the output directory exists for `diagramify diff`.
- Verify files are non-empty after the command succeeds.

## Theme Or Interactive HTML Looks Wrong

- Retry with one of `light`, `dark`, `tokyo-night`, `nord`, or `catppuccin`.
- Use SVG when deterministic, self-contained review is more important than interactivity.
- Interactive HTML may reference hosted fonts or scripts; account for that in offline or restricted environments.
