import { basename, resolve } from 'path';
import type { DiagramifyConfig, DiagramifyResult, GenerateOptions } from './types.js';
import { loadConfig } from './config.js';
import { resolveProviderAndModel, callLLM, callLLMForObject, hasCredentials } from './provider.js';
import { renderGraph } from './render.js';
import { analyzeCodebase } from './analyze.js';
import { architectureGraphSchema, canonicalLabel, shapeForLabel, type ArchitectureGraph } from './ir.js';
import { readGraphDocument } from './graph-document.js';
import { mermaidToGraph } from './ir-mermaid.js';
import { analysisToGraph } from './ir-analyzer.js';
import { createArchitectureRequest, type ArchitectureRequest } from './engines.js';
import { createOllamaEngine } from './ollama.js';
import { assessGraph, mergeInterpretation } from './graph-quality.js';

async function prepare(options: GenerateOptions, config: DiagramifyConfig): Promise<ArchitectureRequest> {
  const title = options.path ? basename(resolve(options.path)) : undefined;
  const direction = (config.direction === 'TB' ? 'TD' : config.direction) ?? 'LR';
  const analysis = options.input === 'codebase'
    ? await analyzeCodebase(options.path || process.cwd())
    : undefined;
  const baseline = analysis ? analysisToGraph(analysis, { title, direction }) : undefined;
  return createArchitectureRequest({
    analysis, baseline, direction,
    description: options.description,
    extraContext: options.extraContext,
  });
}

/** Gives a caller agent the same evidence and output contract used by built-in engines. */
export async function prepareArchitecture(options: GenerateOptions): Promise<ArchitectureRequest> {
  return prepare(options, await loadConfig(options.config));
}

/** Validates an agent proposal and retains the findings from source analysis. */
export function completeArchitecture(request: Pick<ArchitectureRequest, 'baseline'>, value: unknown, source = 'agent'): ArchitectureGraph {
  const parsed = architectureGraphSchema.safeParse(value);
  if (!parsed.success) throw new Error('The interpretation engine returned an invalid graph schema.');
  const baseline = request.baseline ? readGraphDocument(request.baseline) : undefined;
  const status = baseline ? 'inferred' : 'proposed';
  const candidateIds = new Set(parsed.data.nodes.map(node => node.id));
  const referencedIds = new Set(parsed.data.edges.flatMap(edge => [edge.from, edge.to]));
  const references = baseline?.nodes.filter(node => referencedIds.has(node.id) && !candidateIds.has(node.id)) ?? [];
  const graph = readGraphDocument({
    ...parsed.data, version: 1,
    nodes: [...parsed.data.nodes.map(node => ({ ...node,
      label: canonicalLabel(node.label), shape: shapeForLabel(node.label, node.shape),
      groupId: node.groupId || undefined, status,
    })), ...references.map(node => ({ ...node, groupId: undefined }))],
    edges: parsed.data.edges.map(edge => ({ ...edge, status, bidirectional: false })),
    groups: parsed.data.groups.map(group => ({ ...group,
      nodeIds: parsed.data.nodes.filter(node => node.groupId === group.id).map(node => node.id),
    })),
    meta: { source, generatedAt: new Date().toISOString() },
  });
  if (!graph.nodes.length && !baseline) throw new Error('The interpretation engine returned no usable components.');
  return baseline ? readGraphDocument(mergeInterpretation(baseline, graph)) : graph;
}

async function generateWithProvider(request: ArchitectureRequest, config: DiagramifyConfig) {
  const resolved = await resolveProviderAndModel(config, notice => console.error(notice));
  const source = `${resolved.provider}/${resolved.modelId}`;
  console.error(`Using ${source}`);
  try {
    const result = await callLLMForObject(resolved.model, request.systemPrompt, request.prompt,
      architectureGraphSchema, config.maxTokens, config.temperature);
    return { graph: completeArchitecture(request, result.object, source), tokensUsed: result.tokensUsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Authentication, quota, and transport failures must not cause a second generation request.
    if (!/unsupported|not.support|json.schema|response.format/i.test(message)) throw error;
  }
  const result = await callLLM(resolved.model,
    request.systemPrompt.replace('Use the supplied JSON schema.', 'Return Mermaid source. Return no fences or commentary.')
      .replace('Return graph data only.', 'Return diagram source only.'),
    request.prompt, config.maxTokens, config.temperature);
  const sourceText = result.text.replace(/^```(?:mermaid)?\s*\n?|\n?```\s*$/g, '').trim();
  const graph = mermaidToGraph(sourceText);
  if (!graph.nodes.length) throw new Error('The provider returned no usable diagram.');
  graph.meta = { source };
  graph.nodes.forEach(node => { node.status = request.baseline ? 'inferred' : 'proposed'; });
  graph.edges.forEach(edge => { edge.status = request.baseline ? 'inferred' : 'proposed'; });
  return { graph: request.baseline ? mergeInterpretation(request.baseline, graph) : graph, tokensUsed: result.tokensUsed };
}

/** Uses free source analysis unless an available interpretation engine is selected. */
export async function generateGraph(options: GenerateOptions): Promise<{ graph: ArchitectureGraph; tokensUsed: number }> {
  const config = await loadConfig(options.config);
  const request = await prepare(options, config);
  if (options.noLLM) {
    if (!request.baseline) throw new Error('Analysis without a model needs a codebase. Supply a path or an interpretation engine.');
    return { graph: request.baseline, tokensUsed: 0 };
  }
  if (options.engine && config.localModel) throw new Error('Select either a caller engine or a local model.');
  const engine = options.engine ?? (config.localModel ? createOllamaEngine({
    model: config.localModel, baseUrl: config.localModelUrl, maxTokens: config.maxTokens,
  }) : undefined);
  if (engine) {
    const result = await engine.generate(structuredClone(request));
    return { graph: completeArchitecture(request, result.graph, engine.name), tokensUsed: result.tokensUsed ?? 0 };
  }
  if (!hasCredentials(config)) {
    if (request.baseline) return { graph: request.baseline, tokensUsed: 0 };
    throw new Error('A description needs an interpretation engine. Use --local-model, a caller engine, or an optional provider key.');
  }
  return generateWithProvider(request, config);
}

export async function generateDiagram(options: GenerateOptions): Promise<DiagramifyResult> {
  const config = await loadConfig(options.config);
  const { graph, tokensUsed } = await generateGraph(options);
  const formats = config.defaultOutput ?? ['svg', 'mmd'];
  const result = await renderGraph(graph, formats, {
    theme: config.theme, darkMode: config.darkMode, backgroundColor: config.backgroundColor,
    offlineMode: config.offlineMode, title: graph.title,
  });
  return { ...result, tokensUsed, quality: assessGraph(graph) };
}
