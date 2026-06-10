export type DiagramType =
  | 'flowchart'
  | 'sequence'
  | 'class'
  | 'er'
  | 'state'
  | 'xychart'
  | 'auto';

export type OutputFormat = 'svg' | 'png' | 'jpeg' | 'html' | 'mmd';

export type ProviderName = 'anthropic' | 'openai' | 'google';

export interface DiagramifyConfig {
  provider: ProviderName;
  model?: string;
  apiKey?: string;
  theme?: string;
  darkMode?: boolean;
  defaultOutput?: OutputFormat[];
  temperature?: number;
  maxTokens?: number;
  direction?: 'LR' | 'TD' | 'TB' | 'RL';
}

export interface GenerateOptions {
  input: 'codebase' | 'description';
  path?: string;
  description?: string;
  diagramType?: DiagramType;
  extraContext?: string;
  config?: Partial<DiagramifyConfig>;
}

export interface RenderOptions {
  theme?: string;
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
  svg?: string;
  png?: Buffer;
  jpeg?: Buffer;
  html?: string;
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
}
