import { describe, it, expect } from 'vitest';
import { generateInteractiveHTML } from '../core/html.js';

describe('SVG and HTML Structure', () => {
  const testSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
    <g class="dfy-subgraph" data-id="sg1" data-label="Backend">
      <rect x="50" y="50" width="300" height="150" rx="8" fill="none" stroke="#64748b"/>
    </g>
    <g class="dfy-node" data-id="api" data-label="API Server" data-type="compute" data-cx="100" data-cy="100">
      <rect x="50" y="70" width="100" height="60" rx="8" fill="#e2e8f0"/>
    </g>
    <g class="dfy-node" data-id="db" data-label="Database" data-type="database" data-cx="300" data-cy="100">
      <rect x="250" y="70" width="100" height="60" rx="8" fill="#e2e8f0"/>
    </g>
  </svg>`;

  const mermaidSource = `flowchart LR
    API[API Server]
    DB[Database]
    API --> DB`;

  it('generates valid HTML document', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
    expect(html).toContain('<head>');
    expect(html).toContain('</head>');
    expect(html).toContain('<body>');
    expect(html).toContain('</body>');
  });

  it('includes all required meta tags', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);
    expect(html).toContain('charset="UTF-8"');
    expect(html).toContain('viewport');
  });

  it('creates SVG container for edges', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);
    expect(html).toContain('class="edges-svg"');
    expect(html).toContain('id="edges"');
    expect(html).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('includes arrow marker for edges', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);
    expect(html).toContain('id="dfy-arrow"');
    expect(html).toContain('marker-end');
  });

  it('renders node elements in canvas', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);
    expect(html).toContain('id="canvas"');
    expect(html).toContain('data-id');
    expect(html).toContain('data-label');
  });

  it('includes sidebar with legend', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);
    expect(html).toContain('class="sidebar"');
    expect(html).toContain('id="sidebar"');
    expect(html).toContain('legend-item');
  });

  it('includes canvas container', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);
    expect(html).toContain('class="canvas"');
    expect(html).toContain('id="canvas"');
  });

  it('includes header with controls', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);
    expect(html).toContain('class="header"');
    expect(html).toContain('id="theme-btn"');
    expect(html).toContain('id="edit-btn"');
    expect(html).toContain('id="legend-btn"');
  });

  it('includes footer with keyboard shortcuts help', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);
    expect(html).toContain('class="footer-tip"');
    expect(html).toContain('<kbd>');
  });

  it('properly escapes HTML in titles and content', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource, {
      title: 'Test <script>alert("XSS")</script>',
    });
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;/script&gt;');
    expect(html).not.toContain('<script>alert');
  });

  it('includes CSS for all themes', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);
    expect(html).toContain('html[data-theme="dark"]');
    expect(html).toContain('html[data-theme="tokyo-night"]');
    expect(html).toContain('html[data-theme="nord"]');
    expect(html).toContain('html[data-theme="catppuccin"]');
  });

  it('serializes Mermaid source for client', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);
    expect(html).toContain('const MERMAID_SRC');
    expect(html).toContain('flowchart LR');
  });
});
