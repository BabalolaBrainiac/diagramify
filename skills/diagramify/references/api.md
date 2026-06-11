# Diagramify Programmatic API

## Generate

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
