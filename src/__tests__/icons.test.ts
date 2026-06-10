import { describe, it, expect } from 'vitest';
import { getIconURL } from '../icons/simple-icons.js';
import { getServiceDefinition } from '../icons/services.js';

describe('Phase 2: Icon System', () => {
  it('getIconURL for openai returns data URI', () => {
    const url = getIconURL('openai');
    expect(url).toMatch(/^data:/);
  });

  it('getIconURL for anthropic returns data URI', () => {
    const url = getIconURL('anthropic');
    expect(url).toMatch(/^data:/);
  });

  it('getIconURL for nonexistent service returns fallback SVG', () => {
    const url = getIconURL('nonexistent-xyz-service');
    expect(url).toContain('svg');
  });

  it('serviceRegistry has openai with type ai', () => {
    const def = getServiceDefinition('openai');
    expect(def).toBeDefined();
    expect(def?.type).toBe('ai');
  });

  it('serviceRegistry has anthropic with type ai', () => {
    const def = getServiceDefinition('anthropic');
    expect(def).toBeDefined();
    expect(def?.type).toBe('ai');
  });

  it('claude alias resolves to anthropic service', () => {
    const def = getServiceDefinition('claude');
    expect(def).toBeDefined();
    expect(def?.type).toBe('ai');
    expect(def?.name).toContain('Anthropic');
  });
});
