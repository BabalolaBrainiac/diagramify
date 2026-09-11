# Architecture engines

Diagramify separates source analysis, model interpretation, graph validation, and rendering.
The renderer does not need a model or an API key.

| Workflow | Required service | Model cost |
|---|---|---|
| Source analysis | None | None |
| Caller agent | The agent already in use | Depends on that agent |
| Local model | A local Ollama server and an installed model | Local hardware and electricity |
| Hosted model | A configured provider | Provider pricing and quotas |

## Source analysis

```bash
diagramify generate --path . --offline --out html,svg,json
```

Codebase generation also selects source analysis when no engine or provider credentials are available.
`--no-llm` disables inference explicitly.
`--offline` also makes the viewer independent of network resources.

The analyzer retains nested package ownership and source paths for detected components and dependencies.
An installed package does not prove a deployed service.
Generic database libraries do not identify a database engine.
Unknown ownership remains absent when several modules could own a dependency.

## Local models

Install Ollama and a compatible text model separately.
Start the local server before generation.
Use the model identifier shown by `ollama list`.

```bash
diagramify generate --path . --local-model YOUR_INSTALLED_MODEL --out html,json
```

The adapter sends JSON schema constraints, disables thinking, and uses temperature zero.
It accepts only loopback addresses and rejects known cloud models before sending project context.
It does not pull models, send provider keys, or retry with a hosted provider.
The adapter rejects incomplete output, invalid JSON, oversized responses, and timeouts.

Local inference needs no API authentication. See [Ollama authentication](https://docs.ollama.com/api/authentication).
Ollama supports [structured output](https://docs.ollama.com/capabilities/structured-outputs) for local models.
A schema controls output structure. It cannot prove that an architecture claim is correct.

No model is selected or bundled by default.
Model speed, memory use, context capacity, and architecture accuracy require separate evaluation.
A small model can propose additions to the source graph without reproducing every existing node.
Large repositories can exceed the selected model's context capacity. Use a focused project path when necessary.

## Caller agents

The caller can inspect the repository with its existing tools.
It can then return a proposal through the same validation path used by local and hosted models.
No second model call or provider key is required by Diagramify.

```bash
diagramify generate --path . --prepare > request.json
```

Give `request.json` to the caller agent.
Ask it to follow `systemPrompt`, inspect the supplied evidence, and produce `proposal.json` using `schema`.
The proposal can reference baseline node identifiers without repeating those nodes.

```bash
diagramify render proposal.json --request request.json --offline --out html,svg,json
```

Diagramify validates identifiers, connections, groups, and field types.
It retains baseline findings when the proposal omits them.
It marks additions as inferred and does not accept model claims as source evidence.
Distinct node identifiers remain distinct even when their labels match.

The source analyzer remains heuristic. Baseline preservation can also retain a mistaken detection.
Review the evidence before accepting the architecture as accurate.

### Library integration

```typescript
import { prepareArchitecture, completeArchitecture, renderGraph } from 'diagramify-ai';

const request = await prepareArchitecture({ input: 'codebase', path: '.' });
// Obtain this value from the caller agent using request.schema.
const proposal = {
  direction: 'LR', groups: [], nodes: [], edges: [],
};
const graph = completeArchitecture(request, proposal, 'caller-agent');
const result = await renderGraph(graph, ['html', 'json'], { offlineMode: true });
```

`generateDiagram` also accepts an `ArchitectureEngine` through `options.engine`.
Its `generate(request)` method returns `{ graph, tokensUsed? }`.
Use `config.localModel` for the built-in Ollama adapter.
Do not select both a caller engine and `config.localModel`.

`prepareArchitecture` exposes structured findings without copying raw source excerpts into the prompt.
The caller can read relevant files itself when deeper inspection is needed.

## Graph documents and inspection

Use `serializeGraphDocument` for complete graph fields, including geometry, descriptions, evidence, and connection identifiers.
`deserializeGraph` reads this format and existing version-one baselines.
`serializeGraph` retains the reduced format used for architecture comparison.

```bash
diagramify render diagram.json --offline --out html,drawio,excalidraw,json
```

The viewer and editable exports retain saved node positions.
CLI image exports still run automatic layout. Browser image exports use the current canvas positions.
Browser JSON export retains node, connection, group, label, and position edits.
See [shared graph editing](live-editing.md) for undo, live updates, and agent operations.

Use Tab to select a node. Press Enter or Space to inspect it.
The detail panel shows source files, claim status, and unknown connections.
The quality report counts source observations and inferred connections. These counts are not an accuracy score.

## Rendering performance

The renderer shares one Mermaid layout across HTML and image formats.
Dragging updates the moved node's connections and retains existing SVG elements.
Label placement uses route coordinates instead of browser path measurements.
Panning updates the minimap viewport without scanning the nodes again.

See [the browser benchmark](performance.md) for measurements and reproduction commands.

## Next architecture work

- Add language parsers and symbol resolution for imports, calls, and ownership.
- Measure architecture accuracy against reviewed repository fixtures.
- Compare small models by unsupported claims, missed dependencies, latency, memory use, and license terms.
- Evaluate alternative layout and rendering engines against larger diagrams.

Hosted inference is optional. A free provider tier still has quotas and operating costs.
A public hosted endpoint also needs abuse controls and a funding plan.
These services are not required for the open-source core.
