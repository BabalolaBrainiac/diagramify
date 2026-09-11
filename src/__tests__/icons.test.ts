import { describe, it, expect } from 'vitest';
import { getIconURL } from '../icons/simple-icons.js';
import { getServiceDefinition } from '../icons/services.js';

function decodeIcon(url: string): string {
  return Buffer.from(url.split(',')[1], 'base64').toString('utf-8');
}

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

  it('resolves a spaced cloud alias to its exact service', () => {
    expect(getServiceDefinition('AWS S3').name).toBe('S3');
    expect(getServiceDefinition('Cloudflare D1').name).toBe('Cloudflare D1');
  });

  it('draws Kinde with a symbol instead of initials', () => {
    expect(decodeIcon(getIconURL('Kinde'))).not.toContain('<text');
  });

  it('does not assign another vendor logo to an unknown auth component', () => {
    const unknown = decodeIcon(getIconURL('Internal Authentication Gateway'));
    const keycloak = decodeIcon(getIconURL('Keycloak'));

    expect(unknown).not.toBe(keycloak);
    expect(unknown).not.toContain('<text');
  });

  it('draws an internal module with a semantic symbol', () => {
    expect(decodeIcon(getIconURL('Payment Module'))).not.toContain('<text');
  });
});
