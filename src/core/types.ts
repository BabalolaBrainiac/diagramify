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

export interface DiagramifyResult {
  mermaid: string;
  svg?: string;
  png?: Buffer;
  jpeg?: Buffer;
  html?: string;
  diagramType: DiagramType;
  tokensUsed?: number;
}

export interface AnalysisResult {
  summary: string;
  entryPoints: string[];
  fileTree: string;
  keyModules: string[];
  estimatedDiagramType: DiagramType;
  language?: string;
  framework?: string;
}
