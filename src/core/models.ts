/**
 * Picks the provider and the model, so an API key is all a user has to supply.
 *
 * A hardcoded model name is wrong the moment a provider ships a new one. This
 * module asks the provider which models the key can reach, ranks them, and
 * caches the answer. A pinned name is only the fallback for when the network
 * or the endpoint is unavailable.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir, tmpdir } from 'os';
import type { DiagramifyConfig, ProviderName } from './types.js';

/** How much capability to ask for. A diagram is a reasoning task, not a chat. */
export type ModelTier = 'fast' | 'balanced' | 'best';

export const PROVIDERS: ProviderName[] = ['anthropic', 'openai', 'google'];

/** Every environment variable that carries a key, in the order they are tried. */
export const API_KEY_VARIABLES: Record<ProviderName, string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  google: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY'],
};

/**
 * Used only when discovery cannot run. Each name is a stable alias rather than
 * a dated snapshot, so the fallback ages more slowly.
 */
export const FALLBACK_MODELS: Record<ProviderName, Record<ModelTier, string>> = {
  anthropic: {
    fast: 'claude-haiku-4-5',
    balanced: 'claude-sonnet-5',
    best: 'claude-opus-5',
  },
  openai: {
    fast: 'gpt-4o-mini',
    balanced: 'gpt-4o',
    best: 'gpt-4o',
  },
  google: {
    fast: 'gemini-2.5-flash-lite',
    balanced: 'gemini-2.5-flash',
    best: 'gemini-2.5-pro',
  },
};

interface ProviderProbe {
  /** Where to ask, and how to authenticate. */
  request(apiKey: string): { url: string; headers: Record<string, string> };
  /** Pulls model identifiers out of the response body. */
  extract(body: unknown): string[];
  /** False for a model that cannot generate text, such as an embedding model. */
  usable(id: string): boolean;
  /** Where a model sits on the capability scale. */
  tier(id: string): ModelTier | null;
}

/** Excludes a model that cannot take a prompt and return text. */
const NON_TEXT =
  /embed|whisper|tts|audio|speech|image|imagen|veo|dall-?e|moderation|rerank|guard|transcri|computer-use|robotics|realtime/i;

/**
 * A rolling alias such as `gemini-flash-latest` or `claude-sonnet-4-5`.
 *
 * The provider repoints these at its newest build, so an alias keeps working
 * after this package stops being updated. That makes it the best default. It
 * carries no version number, so it has to be ranked before the version test or
 * it sorts to the bottom.
 */
function isAlias(id: string): boolean {
  return /-latest$/i.test(id);
}
/** A build that a provider may withdraw without notice. */
const UNSTABLE = /preview|experimental|-exp\b|-exp-|alpha|beta|nightly|\bdraft\b/i;

const PROBES: Record<ProviderName, ProviderProbe> = {
  anthropic: {
    request: (apiKey) => ({
      url: 'https://api.anthropic.com/v1/models?limit=100',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    }),
    extract: (body) => extractIds(body, ['data'], ['id']),
    usable: (id) => id.startsWith('claude') && !NON_TEXT.test(id),
    tier: (id) => {
      if (/haiku/i.test(id)) return 'fast';
      if (/sonnet|fable/i.test(id)) return 'balanced';
      if (/opus/i.test(id)) return 'best';
      return null;
    },
  },
  openai: {
    request: (apiKey) => ({
      url: 'https://api.openai.com/v1/models',
      headers: { Authorization: `Bearer ${apiKey}` },
    }),
    extract: (body) => extractIds(body, ['data'], ['id']),
    usable: (id) => /^(gpt|o\d)/i.test(id) && !NON_TEXT.test(id) && !/realtime|search|instruct/i.test(id),
    tier: (id) => {
      if (/nano|mini/i.test(id)) return 'fast';
      if (/\bpro\b|-pro/i.test(id)) return 'best';
      return 'balanced';
    },
  },
  google: {
    request: (apiKey) => ({
      // Google takes the key as a header, which keeps it out of the URL.
      url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
      headers: { 'x-goog-api-key': apiKey },
    }),
    extract: (body) => {
      const raw = body as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
      return (raw.models ?? [])
        .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
        .map((m) => (m.name ?? '').replace(/^models\//, ''))
        .filter(Boolean);
    },
    usable: (id) => id.startsWith('gemini') && !NON_TEXT.test(id),
    tier: (id) => {
      if (/flash-lite|\blite\b/i.test(id)) return 'fast';
      if (/\bpro\b|-pro/i.test(id)) return 'best';
      if (/flash/i.test(id)) return 'balanced';
      return null;
    },
  },
};

function extractIds(body: unknown, listKeys: string[], idKeys: string[]): string[] {
  const raw = body as Record<string, unknown>;
  for (const listKey of listKeys) {
    const list = raw?.[listKey];
    if (Array.isArray(list)) {
      return list
        .map((entry) => {
          for (const idKey of idKeys) {
            const value = (entry as Record<string, unknown>)?.[idKey];
            if (typeof value === 'string') {
              return value;
            }
          }
          return '';
        })
        .filter(Boolean);
    }
  }
  return [];
}

/**
 * Reads the family version out of an identifier.
 * `gemini-2.5-flash` gives 2.5, `claude-sonnet-5` gives 5, `gpt-4o` gives 4.
 */
export function versionOf(id: string): number {
  const match = id.match(/(\d+(?:\.\d+)?)/);
  return match ? Number.parseFloat(match[1]) : 0;
}

/** A dated snapshot such as `-20251001`. A newer date wins a tie. */
function snapshotOf(id: string): number {
  const match = id.match(/(20\d{6})/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

/**
 * Ranks the models a key can reach, and returns the best match for the tier.
 *
 * The order is deliberate: a model in the requested tier beats one outside it,
 * a stable build beats a preview, a newer family beats an older one, and a
 * newer snapshot breaks the remaining tie.
 */
export function pickModel(
  provider: ProviderName,
  ids: string[],
  tier: ModelTier = 'balanced',
): string | null {
  const probe = PROBES[provider];
  const usable = ids.filter((id) => probe.usable(id));
  if (usable.length === 0) {
    return null;
  }

  const scored = usable.map((id) => ({
    id,
    inTier: probe.tier(id) === tier,
    stable: !UNSTABLE.test(id),
    alias: isAlias(id),
    version: versionOf(id),
    snapshot: snapshotOf(id),
  }));

  scored.sort((a, b) => {
    // The tier the caller asked for comes first.
    if (a.inTier !== b.inTier) return a.inTier ? -1 : 1;
    // A build the provider may withdraw comes last.
    if (a.stable !== b.stable) return a.stable ? -1 : 1;
    // A rolling alias tracks the provider's own upgrades, so it wins before any
    // version is compared. It has no version number of its own.
    if (a.alias !== b.alias) return a.alias ? -1 : 1;
    if (a.version !== b.version) return b.version - a.version;
    // Between two dated snapshots the newer wins, and an undated name wins over
    // both, because it also follows the provider.
    const aDated = a.snapshot > 0;
    const bDated = b.snapshot > 0;
    if (aDated !== bDated) return aDated ? 1 : -1;
    if (a.snapshot !== b.snapshot) return b.snapshot - a.snapshot;
    return a.id.length - b.id.length;
  });

  return scored[0].id;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Cache
 *
 * Discovery costs one request. Repeating it on every run would be rude to the
 * provider and slow for the user, so the answer is kept for a day.
 * ──────────────────────────────────────────────────────────────────────────── */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  models: string[];
  fetchedAt: number;
}

function cachePath(): string {
  const base =
    process.env.XDG_CACHE_HOME ||
    (homedir() ? join(homedir(), '.cache') : tmpdir());
  return join(base, 'diagramify', 'models.json');
}

function readCache(): Record<string, CacheEntry> {
  try {
    return JSON.parse(readFileSync(cachePath(), 'utf-8'));
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, CacheEntry>): void {
  try {
    mkdirSync(dirname(cachePath()), { recursive: true });
    writeFileSync(cachePath(), JSON.stringify(cache));
  } catch {
    // A cache miss is not worth failing a diagram over.
  }
}

/** Discards every cached list. Exposed so a user can force a fresh lookup. */
export function clearModelCache(): void {
  writeCache({});
}

/* ────────────────────────────────────────────────────────────────────────────
 * Discovery
 * ──────────────────────────────────────────────────────────────────────────── */

/** Asks the provider which models this key can reach. */
export async function discoverModels(
  provider: ProviderName,
  apiKey: string,
  options: { timeoutMs?: number; useCache?: boolean } = {},
): Promise<string[]> {
  const useCache = options.useCache !== false;
  // The key is part of the cache identity, because two keys can differ in access.
  const cacheKey = `${provider}:${fingerprint(apiKey)}`;

  if (useCache) {
    const entry = readCache()[cacheKey];
    if (entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS) {
      return entry.models;
    }
  }

  const probe = PROBES[provider];
  const { url, headers } = probe.request(apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);

  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${provider} model list returned ${response.status}`);
    }

    const models = probe.extract(await response.json());
    if (useCache && models.length > 0) {
      const cache = readCache();
      cache[cacheKey] = { models, fetchedAt: Date.now() };
      writeCache(cache);
    }
    return models;
  } finally {
    clearTimeout(timer);
  }
}

/** A short, non-reversible tag for a key, so no secret reaches the cache file. */
function fingerprint(apiKey: string): string {
  let hash = 0;
  for (let i = 0; i < apiKey.length; i += 1) {
    hash = (Math.imul(31, hash) + apiKey.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Provider detection
 * ──────────────────────────────────────────────────────────────────────────── */

/** Returns the key for a provider, from the config or the environment. */
export function apiKeyFor(provider: ProviderName, config?: Partial<DiagramifyConfig>): string | undefined {
  if (config?.provider === provider && config.apiKey) {
    return config.apiKey;
  }
  for (const name of API_KEY_VARIABLES[provider]) {
    if (process.env[name]) {
      return process.env[name];
    }
  }
  return undefined;
}

/** Every provider this machine holds a key for. */
export function availableProviders(config?: Partial<DiagramifyConfig>): ProviderName[] {
  return PROVIDERS.filter((provider) => Boolean(apiKeyFor(provider, config)));
}

/**
 * Chooses the provider.
 *
 * An explicit choice always wins. Otherwise the key decides, so supplying one
 * key is all a user has to do. With several keys the documented order applies,
 * and `--provider` settles it.
 */
export function detectProvider(config?: Partial<DiagramifyConfig>): ProviderName | null {
  const available = availableProviders(config);
  if (available.length === 0) {
    return null;
  }
  return available[0];
}

/**
 * Resolves the model identifier to pass to the provider.
 *
 * An explicit `--model` wins. Otherwise the provider is asked what it offers,
 * and the best model for the tier is chosen. A failed lookup falls back to a
 * pinned name rather than stopping the run.
 */
export async function resolveModelId(
  provider: ProviderName,
  options: {
    model?: string;
    tier?: ModelTier;
    apiKey?: string;
    discover?: boolean;
    onNotice?: (message: string) => void;
  } = {},
): Promise<string> {
  const tier = options.tier ?? 'balanced';

  if (options.model) {
    return options.model;
  }

  const fallback = FALLBACK_MODELS[provider][tier];

  if (options.discover === false || !options.apiKey) {
    return fallback;
  }

  try {
    const models = await discoverModels(provider, options.apiKey);
    const picked = pickModel(provider, models, tier);
    if (picked) {
      return picked;
    }
    options.onNotice?.(
      `The ${provider} model list held nothing usable. Using ${fallback}.`,
    );
  } catch (error) {
    options.onNotice?.(
      `Could not read the ${provider} model list (${
        error instanceof Error ? error.message : String(error)
      }). Using ${fallback}.`,
    );
  }

  return fallback;
}
