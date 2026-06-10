import { describe, it, expect } from 'vitest';
import { generateInteractiveHTML } from '../core/html.js';

describe('Keyboard Shortcuts in Generated HTML', () => {
  const testSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
    <g class="dfy-node" data-id="api" data-label="API" data-type="compute" data-cx="100" data-cy="100">
      <rect x="50" y="70" width="100" height="60" rx="8" fill="#e2e8f0" stroke="#64748b" stroke-width="2"/>
    </g>
  </svg>`;

  const mermaidSource = `flowchart LR
    API[API Server]`;

  it('includes T keyboard shortcut for theme toggle', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);
    expect(html).toContain("if (k === 't')");
    expect(html).toContain('theme-btn');
  });

  it('includes E keyboard shortcut for edit mode', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);
    expect(html).toContain("else if (k === 'e')");
  });

  it('includes L keyboard shortcut for legend toggle', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);
    expect(html).toContain("else if (k === 'l')");
    expect(html).toContain('legend-btn');
  });

  it('includes R keyboard shortcut for reset', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);
    expect(html).toContain("else if (k === 'r')");
    expect(html).toContain('reset-btn');
  });

  it('includes slash key for search focus', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);
    expect(html).toContain("key === '/'");
    expect(html).toContain('searchInput.focus()');
  });

  it('includes F key for fullscreen', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);
    expect(html).toContain("key.toLowerCase() === 'f'");
    expect(html).toContain('requestFullscreen');
  });

  it('includes Escape key to close detail panel', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);
    expect(html).toContain("key === 'Escape'");
    expect(html).toContain('detailPanel.classList.remove');
  });

  it('prevents shortcuts in contentEditable elements', () => {
    const html = generateInteractiveHTML(testSVG, mermaidSource);
    expect(html).toContain('isContentEditable');
    expect(html).toContain('return');
  });
});
