import { describe, it, expect } from 'vitest';
import { parseMermaidSource } from '../core/parse.js';
import { getServiceDefinition } from '../icons/services.js';
import { getIconURL } from '../icons/simple-icons.js';
import { generateInteractiveHTML } from '../core/html.js';

describe('Edge Cases and Error Handling', () => {
  describe('Parser edge cases', () => {
    it('handles empty flowchart', () => {
      const source = 'flowchart TD';
      const result = parseMermaidSource(source);
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });

    it('handles single node', () => {
      const source = `flowchart TD
        A[Node A]`;
      const result = parseMermaidSource(source);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].id).toBe('A');
    });

    it('handles nodes with special characters in labels', () => {
      const source = `flowchart TD
        A["Node with <script> & special chars"]`;
      const result = parseMermaidSource(source);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].label).toContain('<script>');
    });

    it('handles nodes with numbers', () => {
      const source = `flowchart TD
        A1[Node 1]
        A2[Node 2]
        A1 --> A2`;
      const result = parseMermaidSource(source);
      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);
    });

    it('handles long node labels', () => {
      const source = `flowchart TD
        A[This is a very long node label that goes on and on and might cause rendering issues]`;
      const result = parseMermaidSource(source);
      expect(result.nodes[0].label.length).toBeGreaterThan(30);
    });

    it('detects all flow directions', () => {
      expect(parseMermaidSource('flowchart TD\nA[A]').direction).toBe('TD');
      expect(parseMermaidSource('flowchart LR\nA[A]').direction).toBe('LR');
      expect(parseMermaidSource('flowchart BT\nA[A]').direction).toBe('BT');
      expect(parseMermaidSource('flowchart RL\nA[A]').direction).toBe('RL');
    });

    it('handles empty labels', () => {
      const source = `flowchart TD
        A[]`;
      const result = parseMermaidSource(source);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].label).toBe('');
    });

    it('handles self-referencing edges', () => {
      const source = `flowchart TD
        A[Node A]
        A --> A`;
      const result = parseMermaidSource(source);
      expect(result.edges).toHaveLength(0); // Self-edges filtered out
    });
  });

  describe('Service lookup edge cases', () => {
    it('handles whitespace in service names', () => {
      const def1 = getServiceDefinition('  postgresql  ');
      const def2 = getServiceDefinition('postgresql');
      expect(def1).toEqual(def2);
    });

    it('handles mixed case service names', () => {
      const def1 = getServiceDefinition('PostgreSQL');
      const def2 = getServiceDefinition('postgresql');
      expect(def1).toEqual(def2);
    });

    it('returns fallback for unknown services', () => {
      const def = getServiceDefinition('xyz-unknown-service-12345');
      expect(def).toBeDefined();
      expect(def?.name).toBe('Service');
    });
  });

  describe('Icon URL edge cases', () => {
    it('handles empty service name', () => {
      const url = getIconURL('');
      expect(url).toBeDefined();
    });

    it('handles very long service names', () => {
      const longName = 'a'.repeat(1000);
      const url = getIconURL(longName);
      expect(url).toBeDefined();
    });

    it('handles colors with various formats', () => {
      const url1 = getIconURL('openai', '#ff0000');
      const url2 = getIconURL('openai', 'ff0000');
      const url3 = getIconURL('openai', 'FF0000');
      expect(url1).toBeDefined();
      expect(url2).toBeDefined();
      expect(url3).toBeDefined();
    });

    it('produces valid base64 encoding', () => {
      const url = getIconURL('openai');
      const match = url.match(/^data:image\/svg\+xml;base64,(.+)$/);
      if (match) {
        // Should not throw
        Buffer.from(match[1], 'base64').toString('utf-8');
      }
    });
  });

  describe('HTML generation edge cases', () => {
    it('handles empty SVG', () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"></svg>';
      const mermaid = 'flowchart TD\nA[A]';
      const html = generateInteractiveHTML(svg, mermaid);
      expect(html).toBeDefined();
      expect(html).toContain('<!DOCTYPE html>');
    });

    it('handles very long Mermaid source', () => {
      let source = 'flowchart TD\n';
      for (let i = 0; i < 100; i++) {
        source += `N${i}[Node ${i}]\n`;
      }
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
      const html = generateInteractiveHTML(svg, source);
      expect(html).toContain('MERMAID_SRC');
    });

    it('handles special characters in titles', () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
      const mermaid = 'flowchart TD\nA[A]';
      const html = generateInteractiveHTML(svg, mermaid, {
        title: 'Diagram with "quotes" and <tags> & symbols',
      });
      expect(html).toContain('&quot;');
      expect(html).toContain('&lt;');
    });

    it('handles empty Mermaid source', () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
      const html = generateInteractiveHTML(svg, '');
      expect(html).toBeDefined();
    });
  });

  describe('Theme handling', () => {
    it('defaults to light theme', () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
      const html = generateInteractiveHTML(svg, 'flowchart TD\nA[A]');
      expect(html).toContain('data-theme="light"');
    });

    it('respects provided theme', () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
      const html = generateInteractiveHTML(svg, 'flowchart TD\nA[A]', { theme: 'dark' });
      expect(html).toContain('data-theme="dark"');
    });

    it('falls back to light theme for invalid theme', () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
      const html = generateInteractiveHTML(svg, 'flowchart TD\nA[A]', { theme: 'invalid' as any });
      expect(html).toContain('data-theme="light"');
    });
  });
});
