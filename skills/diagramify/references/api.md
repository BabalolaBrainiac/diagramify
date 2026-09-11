# Diagramify Programmatic API

## Generate

`generateDiagram` accepts an optional `engine` with a `generate(request)` method.
The method returns `{ graph, tokensUsed? }` using the supplied graph schema.
`prepareArchitecture` and `completeArchitecture` expose the same workflow as separate steps.
`renderGraph` validates and renders a complete graph document without inference.

```typescript
import { generateDiagram } from 'diagramify-ai';

const result = await generateDiagram({
  input: 'codebase',
  path: './services/orders',
  diagramType: 'flowchart',
  extraContext: 'Emphasize event publishing and data ownership.',
  config: {
    provider: 'anthropic',
    direction: 'LR',
    theme: 'dark',
    defaultOutput: ['svg', 'html', 'mmd'],
  },
});

console.log(result.mermaid);
```

For description input, set `input: 'description'` and supply `description`. Requested outputs are controlled by `config.defaultOutput`.

## Render

```typescript
import { renderDiagram } from 'diagramify-ai';

const result = await renderDiagram(source, ['svg', 'html', 'png'], {
  theme: 'dark',
  width: 1800,
  quality: 90,
});
```

The result contains `mermaid`, `diagramType`, and the requested output fields. PNG and JPEG outputs are Node.js `Buffer` values.

## Analyze Without An LLM

```typescript
import { analyzeCodebase } from 'diagramify-ai';

const analysis = await analyzeCodebase('.', 100);
console.log(analysis.entryPoints);
console.log(analysis.detectedServices);
console.log(analysis.apiEndpoints);
console.log(analysis.internalLinks);
```

Use analysis as discovery assistance, not proof of the complete runtime architecture.

## Other Exports

The package root also exports:

- `loadConfig`
- `resolveModel`
- `callLLM`
- `generateInteractiveHTML`
- `computeDiff`
- `generateDiffHTML`
- `generateDiffMermaid`

## React

The React export is named `DiagramViewer`:

```tsx
import { DiagramViewer } from 'diagramify-ai/react';

export function Architecture({ source }: { source: string }) {
  return (
    <DiagramViewer
      mermaidSource={source}
      theme="dark"
      width="100%"
      height={700}
      onError={(error) => console.error(error)}
    />
  );
}
```

React and React DOM are optional peer dependencies. The component renders an iframe containing Diagramify's interactive HTML viewer.

Source updates retain the iframe and independent local edits.
`onChange(snapshot)` receives accepted graph changes. `onError(error)` receives rejected source updates.
The React entry builds for browsers without Node.js modules.

## Shared graph editing

`createGraphSession(graph)` provides `read`, `apply`, `replace`, `undo`, `redo`, and `subscribe`.
`apply(operations, expectedRevision)` validates the complete batch before publication.
Stale revisions throw `GraphConflictError`.
Deleting a node also removes its connections. Undo restores the complete graph.

The browser exposes this interface through `window.diagramify`.
`createPreviewServer({ source, port })` starts a local shared graph server.
Read `/api/graph`, then POST `{ expectedRevision, operations }` to `/api/operations`.
HTTP and WebSocket use one port. Live updates use `/updates`.
See `docs/live-editing.md` for operation fields and conflict handling.
