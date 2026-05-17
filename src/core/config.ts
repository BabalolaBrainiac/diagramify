import { resolve } from 'path';
import { existsSync } from 'fs';
import type { DiagramifyConfig, ProviderName } from './types.js';

const DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  google: 'gemini-2.5-flash',
};

const DEFAULTS: DiagramifyConfig = {
  provider: 'anthropic',
  model: DEFAULT_MODELS.anthropic,
  theme: 'default',
  defaultOutput: ['svg', 'mmd'],
  temperature: 0.7,
  maxTokens: 4096,
};

async function loadConfigFile(): Promise<Partial<DiagramifyConfig> | null> {
  const configPaths = [
    resolve(process.cwd(), 'diagramify.config.ts'),
    resolve(process.cwd(), 'diagramify.config.js'),
  ];

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        const module = await import(configPath);
        return module.default || module;
      } catch (error) {
        console.warn(`Failed to load config from ${configPath}:`, error);
      }
    }
  }

  return null;
}

function loadEnvConfig(): Partial<DiagramifyConfig> {
  const config: Partial<DiagramifyConfig> = {};

  if (process.env.DIAGRAMIFY_PROVIDER) {
    config.provider = process.env.DIAGRAMIFY_PROVIDER as ProviderName;
  }

  if (process.env.DIAGRAMIFY_MODEL) {
    config.model = process.env.DIAGRAMIFY_MODEL;
  }

  if (process.env.DIAGRAMIFY_THEME) {
    config.theme = process.env.DIAGRAMIFY_THEME;
  }

  if (process.env.DIAGRAMIFY_API_KEY) {
    config.apiKey = process.env.DIAGRAMIFY_API_KEY;
  }

  return config;
}

export async function loadConfig(
  override?: Partial<DiagramifyConfig>,
): Promise<DiagramifyConfig> {
  const fileConfig = await loadConfigFile();
  const envConfig = loadEnvConfig();

  const merged: DiagramifyConfig = {
    ...DEFAULTS,
    ...fileConfig,
    ...envConfig,
    ...override,
  };

  if (!merged.apiKey) {
    const provider = merged.provider as ProviderName;
    const envVarMap: Record<ProviderName, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      google: 'GOOGLE_GENERATIVE_AI_API_KEY',
    };
    const envVar = envVarMap[provider];
    if (envVar && process.env[envVar]) {
      merged.apiKey = process.env[envVar];
    }
  }

  if (!merged.model) {
    merged.model = DEFAULT_MODELS[merged.provider as ProviderName];
  }

  return merged;
}
