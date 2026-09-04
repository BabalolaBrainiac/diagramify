import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  API_KEY_VARIABLES,
  FALLBACK_MODELS,
  PROVIDERS,
  availableProviders,
  detectProvider,
  pickModel,
  resolveModelId,
  versionOf,
} from '../core/models.js';

const ALL_VARIABLES = PROVIDERS.flatMap((p) => API_KEY_VARIABLES[p]);
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of ALL_VARIABLES) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of ALL_VARIABLES) {
    if (saved[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = saved[name];
    }
  }
});

describe('provider detection', () => {
  it('finds nothing when no key is set', () => {
    expect(detectProvider()).toBeNull();
    expect(availableProviders()).toEqual([]);
  });

  it('picks the provider whose key is present', () => {
    process.env.GEMINI_API_KEY = 'test-value';
    expect(detectProvider()).toBe('google');
  });

  it('accepts either name for the Google key', () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-value';
    expect(detectProvider()).toBe('google');
  });

  it('picks the only provider that has a key, whichever it is', () => {
    for (const provider of PROVIDERS) {
      for (const name of ALL_VARIABLES) {
        delete process.env[name];
      }
      process.env[API_KEY_VARIABLES[provider][0]] = 'test-value';
      expect(detectProvider(), `${provider} was not detected`).toBe(provider);
    }
  });

  it('lists every provider a key exists for', () => {
    process.env.OPENAI_API_KEY = 'test-value';
    process.env.GEMINI_API_KEY = 'test-value';
    expect(availableProviders().sort()).toEqual(['google', 'openai']);
  });

  it('lets a caller supply the key instead of the environment', () => {
    expect(detectProvider({ provider: 'google', apiKey: 'test-value' })).toBe('google');
  });
});

describe('version reading', () => {
  it('reads the family version out of an identifier', () => {
    expect(versionOf('gemini-2.5-flash')).toBe(2.5);
    expect(versionOf('gemini-3-pro')).toBe(3);
    expect(versionOf('claude-sonnet-5')).toBe(5);
    expect(versionOf('gpt-4o')).toBe(4);
  });
});

describe('model ranking', () => {
  it('prefers the newest family', () => {
    const picked = pickModel('google', ['gemini-1.5-flash', 'gemini-2.5-flash', 'gemini-3-flash']);
    expect(picked).toBe('gemini-3-flash');
  });

  it('honours the requested tier over the newest family', () => {
    const picked = pickModel('google', ['gemini-3-flash', 'gemini-2.5-pro'], 'best');
    expect(picked).toBe('gemini-2.5-pro');
  });

  it('prefers a stable build over a preview', () => {
    const picked = pickModel('google', ['gemini-3-flash-preview', 'gemini-3-flash']);
    expect(picked).toBe('gemini-3-flash');
  });

  it('falls back to a preview when nothing stable exists', () => {
    expect(pickModel('google', ['gemini-3-pro-preview'], 'best')).toBe('gemini-3-pro-preview');
  });

  it('prefers a rolling alias over a dated snapshot', () => {
    const picked = pickModel('anthropic', ['claude-sonnet-5-20260101', 'claude-sonnet-5']);
    expect(picked).toBe('claude-sonnet-5');
  });

  it('takes the newest snapshot when only snapshots exist', () => {
    const picked = pickModel('anthropic', ['claude-sonnet-5-20250101', 'claude-sonnet-5-20260101']);
    expect(picked).toBe('claude-sonnet-5-20260101');
  });

  it('leaves out a model that cannot generate text', () => {
    const picked = pickModel('google', ['text-embedding-004', 'imagen-3.0', 'gemini-2.5-flash']);
    expect(picked).toBe('gemini-2.5-flash');
  });

  it('maps each Anthropic family to the right tier', () => {
    const ids = ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5'];
    expect(pickModel('anthropic', ids, 'fast')).toBe('claude-haiku-4-5');
    expect(pickModel('anthropic', ids, 'balanced')).toBe('claude-sonnet-5');
    expect(pickModel('anthropic', ids, 'best')).toBe('claude-opus-5');
  });

  it('maps each Gemini family to the right tier', () => {
    const ids = ['gemini-3-flash-lite', 'gemini-3-flash', 'gemini-3-pro'];
    expect(pickModel('google', ids, 'fast')).toBe('gemini-3-flash-lite');
    expect(pickModel('google', ids, 'balanced')).toBe('gemini-3-flash');
    expect(pickModel('google', ids, 'best')).toBe('gemini-3-pro');
  });

  it('returns nothing when the list holds no usable model', () => {
    expect(pickModel('google', ['text-embedding-004'])).toBeNull();
  });
});

describe('model resolution', () => {
  it('uses an explicit model without asking the provider', async () => {
    const id = await resolveModelId('google', { model: 'gemini-flash-latest' });
    expect(id).toBe('gemini-flash-latest');
  });

  it('uses the pinned model when discovery is switched off', async () => {
    const id = await resolveModelId('google', { discover: false, apiKey: 'test-value' });
    expect(id).toBe(FALLBACK_MODELS.google.balanced);
  });

  it('uses the pinned model when no key is available', async () => {
    const id = await resolveModelId('anthropic', {});
    expect(id).toBe(FALLBACK_MODELS.anthropic.balanced);
  });

  it('honours the tier when it falls back', async () => {
    const id = await resolveModelId('anthropic', { tier: 'best' });
    expect(id).toBe(FALLBACK_MODELS.anthropic.best);
  });

  it('reports why it fell back, rather than failing the run', async () => {
    const notices: string[] = [];
    const id = await resolveModelId('google', {
      apiKey: 'not-a-real-key',
      discover: true,
      timeoutMs: 1,
      onNotice: (message) => notices.push(message),
    } as Parameters<typeof resolveModelId>[1]);

    expect(id).toBe(FALLBACK_MODELS.google.balanced);
    expect(notices.length).toBeGreaterThan(0);
  });
});

describe('fallback names', () => {
  it('names a model for every provider and tier', () => {
    for (const provider of PROVIDERS) {
      for (const tier of ['fast', 'balanced', 'best'] as const) {
        expect(FALLBACK_MODELS[provider][tier], `${provider}/${tier}`).toBeTruthy();
      }
    }
  });
});
