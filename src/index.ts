export { generateDiagram } from './core/generate.js';
export { renderDiagram } from './core/render.js';
export { analyzeCodebase } from './core/analyze.js';
export { loadConfig } from './core/config.js';
export { resolveModel, callLLM } from './core/provider.js';
export { generateInteractiveHTML } from './core/html.js';
export { computeDiff, generateDiffHTML, generateDiffMermaid } from './core/diff.js';
export type { DiagramDiff, NodeDiffEntry, EdgeDiffEntry, SubgraphDiffEntry } from './core/diff.js';
export type {
  DiagramifyConfig,
  GenerateOptions,
  RenderOptions,
  DiagramifyResult,
  AnalysisResult,
  DiagramType,
  OutputFormat,
  ProviderName,
} from './core/types.js';
