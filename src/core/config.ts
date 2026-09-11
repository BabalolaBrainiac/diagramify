import { resolve } from 'path';
import { existsSync } from 'fs';
import type { DiagramifyConfig, ProviderName } from './types.js';
import { apiKeyFor, detectProvider } from './models.js';

const DEFAULTS: Omit<DiagramifyConfig, 'provider'> = {
  theme: 'default',
  defaultOutput: ['svg', 'mmd'],
  temperature: 0,
  maxTokens: 8192,
  tier: 'balanced',
  discoverModels: true,
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

  if (process.env.DIAGRAMIFY_LOCAL_MODEL) config.localModel = process.env.DIAGRAMIFY_LOCAL_MODEL;
  if (process.env.DIAGRAMIFY_LOCAL_MODEL_URL) config.localModelUrl = process.env.DIAGRAMIFY_LOCAL_MODEL_URL;

  if (process.env.DIAGRAMIFY_THEME) {
    config.theme = process.env.DIAGRAMIFY_THEME;
  }

  if (process.env.DIAGRAMIFY_API_KEY) {
    config.apiKey = process.env.DIAGRAMIFY_API_KEY;
  }

  return config;
}

function withoutUndefined<T extends object>(value: T | null | undefined): Partial<T> {
  return Object.fromEntries(
    Object.entries(value ?? {}).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

export async function loadConfig(
  override?: Partial<DiagramifyConfig>,
): Promise<DiagramifyConfig> {
  const fileConfig = await loadConfigFile();
  const envConfig = loadEnvConfig();

  const merged = {
    ...DEFAULTS,
    ...withoutUndefined(fileConfig),
    ...withoutUndefined(envConfig),
    ...withoutUndefined(override),
  } as DiagramifyConfig;

  // Whichever key exists decides the provider, so supplying one key is all a
  // user has to do. A flag, the environment, or a config file still wins.
  if (!merged.provider) {
    merged.provider = detectProvider(merged) ?? ('anthropic' as ProviderName);
  }

  if (!merged.apiKey) {
    // One lookup for every provider, including the Gemini variable name.
    const found = apiKeyFor(merged.provider, merged);
    if (found) {
      merged.apiKey = found;
    }
  }

  // The model stays undefined here. It resolves against the live provider at
  // call time, so a newly released model needs no new release of this package.
  return merged;
}
