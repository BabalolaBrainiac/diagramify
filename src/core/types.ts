import type { ArchitectureGraph } from './ir.js';

export type DiagramType =
  | 'flowchart'
  | 'sequence'
  | 'class'
  | 'er'
  | 'state'
  | 'xychart'
  | 'auto';

export type OutputFormat =
  | 'svg'
  | 'png'
  | 'jpeg'
  | 'html'
  | 'mmd'
  | 'pdf'
  | 'drawio'
  | 'excalidraw'
  | 'json';

export type ProviderName = 'anthropic' | 'openai' | 'google';

export interface DiagramifyConfig {
  provider: ProviderName;
  model?: string;
  /** How much capability to ask for when no model is named. */
  tier?: 'fast' | 'balanced' | 'best';
  /** Set false to skip the provider model lookup and use a pinned name. */
  discoverModels?: boolean;
  apiKey?: string;
  theme?: string;
  darkMode?: boolean;
  /** Background color for SVG and raster output. Use `transparent` to keep the alpha channel. */
  backgroundColor?: string;
  /** Make the HTML viewer self-contained. It then issues no network request. */
  offlineMode?: boolean;
  defaultOutput?: OutputFormat[];
  temperature?: number;
  maxTokens?: number;
  direction?: 'LR' | 'TD' | 'TB' | 'RL' | 'BT';
}

export interface GenerateOptions {
  input: 'codebase' | 'description';
  path?: string;
  description?: string;
  diagramType?: DiagramType;
  extraContext?: string;
  config?: Partial<DiagramifyConfig>;
  /** Build the graph from the codebase alone. No provider and no network. */
  noLLM?: boolean;
}

export interface RenderOptions {
  theme?: string;
  /** Make the HTML viewer self-contained. It then issues no network request. */
  offlineMode?: boolean;
  /** Shown as the document title, and used by the PDF and editable exports. */
  title?: string;
  /** Reuse an existing graph instead of parsing the Mermaid source again. */
  graph?: ArchitectureGraph;
  width?: number;
  height?: number;
  backgroundColor?: string;
  quality?: number;
  darkMode?: boolean;
}

export interface HTMLGenerationOptions extends RenderOptions {
  title?: string;
  showMinimap?: boolean;
  showSearch?: boolean;
  showLayerPanel?: boolean;
  showNodeDetail?: boolean;
  offlineMode?: boolean;
}

export interface DiagramifyResult {
  mermaid: string;
  /** The typed graph the diagram came from. Every exporter reads this. */
  graph?: ArchitectureGraph;
  svg?: string;
  png?: Buffer;
  jpeg?: Buffer;
  html?: string;
  pdf?: Buffer;
  drawio?: string;
  excalidraw?: string;
  /** The IR as stable JSON. The CI drift gate compares this. */
  json?: string;
  diagramType: DiagramType;
  tokensUsed?: number;
}

export interface DetectedDependency {
  name: string;
  rawName: string;
  version?: string;
  type: 'database' | 'cache' | 'messaging' | 'auth' | 'monitoring' | 'compute' | 'storage' | 'other';
}

export interface DetectedEndpoint {
  path: string;
  method?: string;
  file: string;
}

export interface EvidenceItem {
  service: string;
  source: string;
  hint: string;
}

export interface DetectedServiceLink {
  from: string;
  to: string;
  label: string;
  kind: 'sync' | 'async';
  source: string;
}

export interface AnalysisResult {
  summary: string;
  entryPoints: string[];
  fileTree: string;
  keyModules: string[];
  estimatedDiagramType: DiagramType;
  language?: string;
  framework?: string;
  detectedDependencies: DetectedDependency[];
  detectedServices: string[];
  envServices: string[];
  apiEndpoints: DetectedEndpoint[];
  serviceDirectories: string[];
  internalLinks?: Array<{from: string; to: string}>;
  serviceLinks?: DetectedServiceLink[];
  /** Components proved by an environment file, a container file, or infra code. */
  evidence?: EvidenceItem[];
}
