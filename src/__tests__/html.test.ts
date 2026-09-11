import { describe, it, expect } from 'vitest';
import { generateInteractiveHTML } from '../core/html.js';

describe('Phase 1: Interactive HTML Generation', () => {
  const testSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
    <g class="dfy-subgraph" data-id="sg1" data-label="Backend">
      <rect x="50" y="50" width="300" height="150" rx="8" fill="none" stroke="#64748b" stroke-width="2" stroke-dasharray="4"/>
    </g>
    <g class="dfy-node" data-id="api" data-label="API" data-type="compute" data-cx="100" data-cy="100">
      <rect x="50" y="70" width="100" height="60" rx="8" fill="#e2e8f0" stroke="#64748b" stroke-width="2"/>
      <text x="100" y="105" text-anchor="middle" font-size="14" font-weight="600">API</text>
    </g>
    <g class="dfy-node" data-id="db" data-label="Database" data-type="database" data-cx="300" data-cy="100">
      <rect x="250" y="70" width="100" height="60" rx="8" fill="#e2e8f0" stroke="#64748b" stroke-width="2"/>
      <text x="300" y="105" text-anchor="middle" font-size="14" font-weight="600">DB</text>
    </g>
  </svg>`;

  const mermaidSource = `flowchart LR
    API[API Server]
    DB[Database]
    API --> DB`;

  it('generates HTML with search input', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource, { showSearch: true });
    expect(html).toContain('id="dfy-search"');
    expect(html).toContain('placeholder="Search nodes');
    expect(html).toContain('searchInput.addEventListener');
  });

  it('generates HTML with minimap', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource, { showMinimap: true });
    expect(html).toContain('id="dfy-minimap-canvas"');
    expect(html).toContain('id="dfy-minimap-viewport"');
    expect(html).toContain('renderMinimap()');
    expect(html).toContain('minimapCanvas.addEventListener');
  });

  it('generates HTML with detail panel', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource, { showNodeDetail: true });
    expect(html).toContain('id="dfy-detail"');
    expect(html).toContain('id="dfy-detail-close"');
    expect(html).toContain('id="dfy-detail-content"');
    expect(html).toContain('detailPanel.classList');
  });

  it('generates HTML with layer panel', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource, { showLayerPanel: true });
    expect(html).toContain('id="layer-list"');
    expect(html).toContain('layerList.appendChild');
  });

  it('includes keyboard shortcuts', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);
    expect(html).toContain("key === '/'");
    expect(html).toContain("key.toLowerCase() === 'f'");
    expect(html).toContain("key === 'Escape'");
  });

  it('omits optional features when showXXX is false', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource, {
      showMinimap: false,
      showNodeDetail: false,
    });
    expect(html).not.toContain('id="dfy-minimap"');
    expect(html).not.toContain('id="dfy-detail"');
  });

  it('sets custom title', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource, { title: 'My Custom Diagram' });
    expect(html).toContain('<title>My Custom Diagram</title>');
    expect(html).toContain('My Custom Diagram');
  });

  it('includes theme CSS variables', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource, { theme: 'dark' });
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain('--bg');
    expect(html).toContain('--surface');
    expect(html).toContain('--text');
  });

  it('includes panzoom library script', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);
    expect(html).toContain('panzoom');
    expect(html).toContain('Panzoom');
  });

  it('serializes layout data for client script', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);
    expect(html).toContain('const NODES =');
    expect(html).toContain('let EDGES =');
    expect(html).toContain('const VIEWBOX =');
    expect(html).toContain('const MERMAID_SRC =');
  });

  it('includes legend with service types', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);
    expect(html).toContain('Service Types');
    expect(html).toContain('data-type');
    expect(html).toContain('legend-item');
  });

  it('keeps dark brand icons visible in dark themes', () => {
    const kindeSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
      <g class="node" data-id="kinde" data-label="Kinde"><rect x="50" y="30" width="100" height="40"/></g>
    </svg>`;
    const html = generateInteractiveHTML(kindeSVG, mermaidSource);

    expect(html).toContain('dfy-icon-needs-contrast');
    expect(html).toContain('filter:brightness(0) invert(1)');
  });

  it('includes export controls', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);
    expect(html).toContain('id="format-select"');
    expect(html).toContain('html');
    expect(html).toContain('svg');
    expect(html).toContain('mmd');
  });

  it('offers light and dark image and PDF exports', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);

    for (const format of ['png', 'jpeg', 'svg', 'pdf']) {
      expect(html).toContain(`value="${format}:light"`);
      expect(html).toContain(`value="${format}:dark"`);
    }
    expect(html).toContain("theme ? '-' + theme : ''");
  });

  it('keeps a complete edge label above its line', () => {
    const edgeSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
      <g class="node" data-id="api" data-label="API"><rect x="20" y="100" width="80" height="40"/></g>
      <g class="node" data-id="db" data-label="Database"><rect x="300" y="100" width="80" height="40"/></g>
      <polyline class="edge" data-from="api" data-to="db" data-style="solid" data-label="SQL LISTEN/NOTIFY event payload" />
    </svg>`;
    const html = generateInteractiveHTML(edgeSVG, mermaidSource);

    expect(html).toContain('SQL LISTEN/NOTIFY event payload');
    expect(html).not.toContain('SQL LISTEN/NOTIFY...');
    expect(html).toContain('function labelAnchor');
    expect(html).toContain('function separateLabel');
    expect(html).toContain('edge-label-secondary');
    expect(html).toContain('/^(uses|routes)$/i');
    expect(html).toContain('paint-order:stroke fill');
  });

  it('keeps hidden connections stable after edge redraws', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);

    expect(html).toContain('id="hide-btn"');
    expect(html).toContain('hideButton.disabled = !el');
    expect(html).toContain("filter(element => !element.dataset.dfyHidden &&");
    expect(html).toContain('data-edge-key');
    expect(html).toContain('hiddenEdgeKeys.has');
  });

  it('includes theme toggle button', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);
    expect(html).toContain('id="theme-btn"');
    expect(html).toContain('setTheme');
  });

  it('handles missing options gracefully', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);
    expect(html).toBeDefined();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('does not allow Mermaid source to break out of the generated script', () => {
    const malicious = 'flowchart TD\nA["</script><script>alert(1)</script>"]';
    const html = generateInteractiveHTML(testSVG, malicious);

    expect(html).not.toContain('</script><script>alert(1)</script>');
    expect(html).toContain('\\u003c/script\\u003e');
  });
});
