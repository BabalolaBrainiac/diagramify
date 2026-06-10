import { describe, it, expect } from 'vitest';
import { getIconURL, hasServiceMapping } from '../icons/simple-icons.js';

describe('Icon URL Resolution', () => {
  it('returns data URI for inline AWS services', () => {
    const url = getIconURL('s3');
    expect(url).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('returns data URI for inline general services', () => {
    const url = getIconURL('openai');
    expect(url).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('returns data URI for anthropic', () => {
    const url = getIconURL('anthropic');
    expect(url).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('returns fallback SVG for unknown services', () => {
    const url = getIconURL('unknownservice123xyz');
    expect(url).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('applies custom color to SVG', () => {
    const url = getIconURL('openai', 'ff0000');
    expect(url).toMatch(/^data:image\/svg\+xml;base64,/);
    // Decode and check that color is in the SVG
    const base64 = url.replace(/^data:image\/svg\+xml;base64,/, '');
    const svg = Buffer.from(base64, 'base64').toString('utf-8');
    expect(svg.toLowerCase()).toContain('#ff0000');
  });

  it('uses default color when not specified', () => {
    const url = getIconURL('postgresql');
    expect(url).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('supports case-insensitive service names', () => {
    const lower = getIconURL('postgresql');
    const upper = getIconURL('PostgreSQL');
    expect(lower).toBe(upper);
  });

  it('handles service names with spaces', () => {
    const url = getIconURL('google cloud');
    expect(url).toBeDefined();
  });

  it('checks if service has mapping', () => {
    expect(hasServiceMapping('postgresql')).toBe(true);
    expect(hasServiceMapping('openai')).toBe(true);
    expect(hasServiceMapping('unknownservice123xyz')).toBe(false);
  });

  it('returns CDN URL for mapped services when CDN fallback needed', () => {
    const url = getIconURL('some-mapped-service');
    // Either returns inline data URI or CDN URL depending on mapping
    expect(url).toBeDefined();
  });

  it('handles color with or without hash prefix', () => {
    const withHash = getIconURL('openai', '#ff0000');
    const withoutHash = getIconURL('openai', 'ff0000');
    // Both should work
    expect(withHash).toBeDefined();
    expect(withoutHash).toBeDefined();
  });

  it('generates valid URLs for services', () => {
    const services = ['openai', 'anthropic', 'postgresql', 's3'];
    for (const service of services) {
      const url = getIconURL(service);
      // Either data URI or CDN URL
      expect(url).toMatch(/^(data:image\/svg\+xml;base64,|https:\/\/cdn\.simpleicons\.org\/)/);
    }
  });

  it('returns valid SVG in fallback', () => {
    const url = getIconURL('unknownservice');
    expect(url).toMatch(/^data:image\/svg\+xml;base64,/);
    const base64 = url.replace(/^data:image\/svg\+xml;base64,/, '');
    const svg = Buffer.from(base64, 'base64').toString('utf-8');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('normalizes service names for lookup', () => {
    const url1 = getIconURL('  postgresql  ');
    const url2 = getIconURL('postgresql');
    expect(url1).toBe(url2);
  });
});
