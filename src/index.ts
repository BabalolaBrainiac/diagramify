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

// The Architecture IR. Every renderer and exporter reads this one type.
export {
  architectureGraphSchema,
  deserializeGraph,
  emptyGraph,
  normalizeGraph,
  safeId,
  serializeGraph,
  validateGraph,
} from './core/ir.js';
export type {
  ArchitectureGraph,
  ArchitectureGraphInput,
  Direction,
  EdgeKind,
  IREdge,
  IRGroup,
  IRNode,
  NodeLayout,
  NodeShape,
} from './core/ir.js';

export { generateGraph } from './core/generate.js';
export { analysisToGraph } from './core/ir-analyzer.js';
export { graphToMermaid, mermaidToGraph } from './core/ir-mermaid.js';
export { attachLayout, hasLayout, readExtent } from './core/ir-layout.js';
export { svgToPDF } from './core/export/pdf.js';
export { graphToDrawio, graphToExcalidraw } from './core/export/editable.js';
export { compareGraphs, formatDriftReport } from './core/drift.js';
export type { DriftReport, EdgeChange, NodeChange } from './core/drift.js';
