# Shared graph editing

Diagramify gives browser input and agents the same graph operations.
The graph stores nodes, connections, groups, evidence, and positions.
Each accepted change has a revision number.
An operation must use the current revision.

## Browser controls

- Drag a node or group to move it. One drag creates one history entry.
- Press `E` to edit labels. Press Enter to save. Press Escape to cancel.
- Select a node, connection, or group. Press Delete to remove it.
- Copy and paste a selected node with `Ctrl+C` and `Ctrl+V`.
- Undo with `Ctrl+Z`. Redo with `Ctrl+Shift+Z` or `Ctrl+Y`.
- Use Command instead of Ctrl on macOS.
- Export **Architecture IR — with edits** to save the complete graph as JSON.

Deleting a node also removes its connections and group membership.
Deleting a group retains its nodes.
Pasted nodes receive unique identifiers and a proposed status.
Undo and redo retain all graph fields. History contains at most 50 changes.
Search, hidden elements, theme, and viewport settings belong to the viewer. Graph history does not store these settings.

## Agent operations

An agent can use the browser controller through `window.diagramify`.
The Node.js library exposes the same session implementation.

```ts
import { createGraphSession, GraphConflictError } from 'diagramify-ai';

const session = createGraphSession(graph);
const current = session.read();

try {
  const next = session.apply([
    { type: 'node.add', node: { id: 'Queue', label: 'RabbitMQ', status: 'proposed' } },
    { type: 'edge.add', edge: { id: 'orders_events', from: 'Orders', to: 'Queue', kind: 'async' } },
  ], current.revision);
  console.log(next.revision);
} catch (error) {
  if (error instanceof GraphConflictError) {
    // Read the current graph before preparing another edit.
    console.log(session.read());
  } else throw error;
}
```

The example requires an existing node named `Orders`.
Each batch applies all operations or none.
Invalid connections, duplicate identifiers, inconsistent groups, and stale revisions fail before publication.

| Operation | Fields |
|---|---|
| `node.add` | `node` |
| `node.update` | `id`, `changes` |
| `node.remove` | `id` |
| `edge.add` | `edge` |
| `edge.update` | `id`, `changes` |
| `edge.remove` | `id` |
| `group.add` | `group` |
| `group.update` | `id`, `label` |
| `group.remove` | `id` |

Use `node.update` with `groupId` to move a node between groups.
Use `groupId: null` to remove its group membership.
Node and connection identifiers remain fixed during updates.
Moving a node or changing connection endpoints removes obsolete route coordinates.

`session.replace(graph, revision)` compares the source, local graph, and incoming graph.
It retains independent edits and rejects conflicting changes to the same field.
`session.replace(graph, revision, false)` explicitly replaces local edits.
`previewReplacement` checks this merge without changing the session.
`commit` replaces the graph while retaining the source baseline.
`acknowledge` updates the source baseline after an external service accepts an edit.
Transport integrations use the last two methods. Ordinary callers can use `apply` and `replace`.

`subscribe(listener)` returns an unsubscribe function.
Each listener receives a separate snapshot. A failed listener cannot roll back an accepted edit.

## Local preview

```bash
diagramify preview --file architecture.mmd --port 3000
```

`preview`, `dev`, and `watch` share one local graph server.
HTTP and WebSocket connections use the same port. WebSocket updates use `/updates`.
The server binds to `127.0.0.1`.
It rejects foreign browser origins and unexpected Host headers.
Requests have a 2 MiB limit and a local rate limit.
This server does not provide hosted authentication or persistent collaboration storage.

| Route | Purpose |
|---|---|
| `GET /api/graph` | Read `{ revision, graph }` |
| `POST /api/operations` | Apply `{ expectedRevision, operations }` |
| `GET /api/source` | Read Mermaid generated from the current graph |
| `POST /api/update` | Submit Mermaid text as a source update |

The operation route returns HTTP 409 for stale revisions.
It returns HTTP 400 for invalid updates.
The text route checks the revision when the request starts. Agents should use operations for explicit revision checks.

```js
const base = 'http://127.0.0.1:3000';
const snapshot = await fetch(base + '/api/graph').then(response => response.json());
const response = await fetch(base + '/api/operations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    expectedRevision: snapshot.revision,
    operations: [{ type: 'node.update', id: 'Orders', changes: { description: 'Handles order requests.' } }],
  }),
});
if (!response.ok) throw new Error('Read the current graph before retrying.');
```

Browser edits reach the shared graph after each completed edit.
File and agent updates retain the page, viewport, selection, filters, and independent local edits.
An update waits while the user drags a node or edits a label.
Conflicting edits remain visible until the user chooses the shared graph.
Disconnected viewers keep local edits in memory and try to reconnect.
Closing the page loses unsaved memory. Export JSON to retain a copy.

The server does not write browser edits into the watched source file.
`watch` writes `watch-preview.html` beside the source, or in `--outdir`.
Use the served URL for live updates. The saved HTML supports local editing without a server.
File watching also handles editors that save files through an atomic rename.

## React embedding

```tsx
import { DiagramViewer } from 'diagramify-ai/react';

<DiagramViewer
  mermaidSource={source}
  offlineMode
  height={600}
  onChange={snapshot => saveGraph(snapshot.graph)}
  onError={error => showError(error.message)}
/>
```

The React entry can build for browsers without Node.js modules or the image rasterizer.
It retains the iframe document when source or display options change.
The `onChange` callback receives accepted graph changes, including source updates and undo.
Invalid source updates keep the last valid diagram and show an error.
Model selection and inference remain outside the viewer.

## Current limits

Graph operations target architecture flowcharts. Other diagram types do not have an equivalent editable graph model.
Connections can be added through operations. The viewer does not yet provide a connection drawing control.
New graph nodes without positions receive an initial layout. Direct browser operations use a grid position when no layout is supplied.
Large diagrams still require tests on slower devices and more complex connection patterns.
