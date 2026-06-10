import { describe, it, expect } from 'vitest';
import type { DiagramType, OutputFormat, ProviderName, DiagramifyConfig } from '../core/types.js';

describe('Type Definitions', () => {
  it('supports DiagramType values', () => {
    const types: DiagramType[] = ['sequence', 'flowchart', 'class', 'state', 'er'];
    expect(types).toHaveLength(5);
  });

  it('supports OutputFormat values', () => {
    const formats: OutputFormat[] = ['mmd', 'svg', 'html', 'png', 'jpeg'];
    expect(formats).toHaveLength(5);
  });

  it('supports ProviderName values', () => {
    const providers: ProviderName[] = ['anthropic', 'openai', 'google'];
    expect(providers).toHaveLength(3);
  });

  it('DiagramifyConfig has all required fields', () => {
    const config: DiagramifyConfig = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    };
    expect(config.provider).toBeDefined();
    expect(config.model).toBeDefined();
  });

  it('DiagramifyConfig optional fields are optional', () => {
    const minimalConfig: DiagramifyConfig = {
      provider: 'anthropic',
    };
    expect(minimalConfig).toBeDefined();
  });

  it('DiagramifyConfig accepts all provider types', () => {
    const providers: ProviderName[] = ['anthropic', 'openai', 'google'];
    for (const provider of providers) {
      const config: DiagramifyConfig = { provider };
      expect(config.provider).toBe(provider);
    }
  });
});
