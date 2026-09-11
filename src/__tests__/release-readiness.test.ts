import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { loadConfig } from '../core/config.js';
import { renderDiagram } from '../core/render.js';
import { generateGitHubActionsWorkflow } from '../core/ci/github.js';
import { generateGitLabCI } from '../core/ci/gitlab.js';
import { generatePrecommitHook } from '../core/ci/precommit.js';

const originalProvider = process.env.DIAGRAMIFY_PROVIDER;
const originalModel = process.env.DIAGRAMIFY_MODEL;

afterEach(() => {
  if (originalProvider === undefined) delete process.env.DIAGRAMIFY_PROVIDER;
  else process.env.DIAGRAMIFY_PROVIDER = originalProvider;

  if (originalModel === undefined) delete process.env.DIAGRAMIFY_MODEL;
  else process.env.DIAGRAMIFY_MODEL = originalModel;
});

describe('release readiness regressions', () => {
  it('keeps the provider that was asked for, and leaves the model open', async () => {
    delete process.env.DIAGRAMIFY_MODEL;

    // The model is chosen against the live provider at call time. Pinning one
    // here would go stale the moment a provider ships a new model.
    for (const provider of ['google', 'openai', 'anthropic'] as const) {
      const config = await loadConfig({ provider });
      expect(config.provider).toBe(provider);
      expect(config.model).toBeUndefined();
    }
  });

  it('keeps an explicit model, so a caller can pin one', async () => {
    const config = await loadConfig({ provider: 'google', model: 'gemini-flash-latest' });
    expect(config.model).toBe('gemini-flash-latest');
  });

  it('ignores undefined config overrides from optional CLI flags', async () => {
    const config = await loadConfig({ provider: undefined });
    expect(config.provider).toBeTruthy();
    expect(config.tier).toBe('balanced');
  });

  it.each([
    ['classDiagram\nclass User', 'class'],
    ['erDiagram\nUSER {}', 'er'],
    ['stateDiagram-v2\n[*] --> Ready', 'state'],
    ['%%{init: {"flowchart": {"nodeSpacing": 100}}}%%\nflowchart LR\nA[A]', 'flowchart'],
  ] as const)('detects %s as %s', async (source, expected) => {
    const result = await renderDiagram(source, ['mmd']);
    expect(result.diagramType).toBe(expected);
  });

  it('generates CI commands using the published npm package name', () => {
    expect(generateGitHubActionsWorkflow({})).toContain('npx diagramify-ai generate');
    expect(generateGitLabCI({})).toContain('npx diagramify-ai generate');
    expect(generatePrecommitHook()).toContain('npx diagramify-ai generate');
  });

  it('renders PNG output with nonblank pixels', async () => {
    const result = await renderDiagram('flowchart LR\nA[API] --> B[PostgreSQL]', ['png'], {
      theme: 'dark',
      width: 800,
    });

    expect(result.png).toBeDefined();

    const { data, info } = await sharp(result.png).raw().toBuffer({ resolveWithObject: true });
    let nonBlackPixels = 0;

    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i] > 15 || data[i + 1] > 15 || data[i + 2] > 15) {
        nonBlackPixels++;
      }
    }

    expect(nonBlackPixels).toBeGreaterThan(0);
  });
});
