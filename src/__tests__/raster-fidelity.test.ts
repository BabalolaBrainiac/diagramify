import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { renderDiagram } from '../core/render.js';
import {
  collectVariables,
  flattenSVGColors,
  parseColor,
  resolveValue,
} from '../core/styling/flatten.js';

const SOURCE = `flowchart LR
    A[Client] --> B[API]
    B --> C[(Postgres)]
    B --> D[(Redis)]`;

const THEMES = ['light', 'dark', 'tokyo-night', 'nord', 'catppuccin'];

describe('CSS color flattening', () => {
  it('reads hex, short hex, and rgb colors', () => {
    expect(parseColor('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30 });
    expect(parseColor('not-a-color')).toBeNull();
  });

  it('resolves a custom property to its declared value', () => {
    const variables = new Map([['--fg', '#102030']]);
    expect(resolveValue('var(--fg)', variables)).toBe('#102030');
  });

  it('resolves a custom property through a chain of references', () => {
    const variables = new Map([
      ['--fg', '#ffffff'],
      ['--_text', 'var(--fg)'],
    ]);
    expect(resolveValue('var(--_text)', variables)).toBe('#ffffff');
  });

  it('uses the fallback when a custom property has no declaration', () => {
    expect(resolveValue('var(--missing, #abcdef)', new Map())).toBe('#abcdef');
  });

  it('evaluates color-mix in the sRGB space', () => {
    const variables = new Map([
      ['--fg', '#000000'],
      ['--bg', '#ffffff'],
    ]);
    expect(resolveValue('color-mix(in srgb, var(--fg) 50%, var(--bg))', variables)).toBe('#808080');
    expect(resolveValue('color-mix(in srgb, var(--fg) 0%, var(--bg))', variables)).toBe('#ffffff');
    expect(resolveValue('color-mix(in srgb, var(--fg) 100%, var(--bg))', variables)).toBe('#000000');
  });

  it('evaluates a color-mix nested in a var fallback', () => {
    const variables = new Map([
      ['--fg', '#000000'],
      ['--bg', '#ffffff'],
      ['--_line', 'var(--line, color-mix(in srgb, var(--fg) 50%, var(--bg)))'],
    ]);
    expect(resolveValue('var(--_line)', variables)).toBe('#808080');
  });

  it('keeps the original text when a reference cannot resolve', () => {
    expect(resolveValue('var(--missing)', new Map())).toBe('var(--missing)');
  });

  it('collects every custom property declaration', () => {
    const svg = '<svg style="--bg:#0a0a0f;--fg:#e2e8f0"><style>svg { --line: #475569; }</style></svg>';
    const variables = collectVariables(svg);
    expect(variables.get('--bg')).toBe('#0a0a0f');
    expect(variables.get('--fg')).toBe('#e2e8f0');
    expect(variables.get('--line')).toBe('#475569');
  });

  it('rewrites a paint attribute to a literal color', () => {
    const svg = '<svg style="--fg:#112233"><rect fill="var(--fg)"/></svg>';
    expect(flattenSVGColors(svg)).toContain('fill="#112233"');
  });

  it('keeps a custom property definition so a browser can still theme the SVG', () => {
    const svg = '<svg style="--fg:#112233"><style>svg { --_text: var(--fg); }</style><text fill="var(--_text)">x</text></svg>';
    const flattened = flattenSVGColors(svg);
    expect(flattened).toContain('fill="#112233"');
    expect(flattened).toContain('--_text: var(--fg)');
  });
});

describe('raster output fidelity', () => {
  it('leaves no unresolved paint reference in the SVG', async () => {
    for (const theme of THEMES) {
      const result = await renderDiagram(SOURCE, ['svg'], { theme });
      const paints = result.svg?.match(/\s(?:fill|stroke)="[^"]*"/g) ?? [];
      const unresolved = paints.filter((p) => p.includes('var(') || p.includes('color-mix('));
      expect(unresolved, `theme ${theme} left unresolved paints`).toEqual([]);
    }
  });

  it('paints an opaque theme background behind the diagram', async () => {
    for (const theme of THEMES) {
      const result = await renderDiagram(SOURCE, ['svg'], { theme });
      expect(result.svg, `theme ${theme} has no background rectangle`).toContain('data-diagramify-bg');
    }
  });

  it('keeps the alpha channel when the background is transparent', async () => {
    const result = await renderDiagram(SOURCE, ['svg'], {
      theme: 'dark',
      backgroundColor: 'transparent',
    });
    expect(result.svg).not.toContain('data-diagramify-bg');
  });

  it('honours an explicit background color', async () => {
    const result = await renderDiagram(SOURCE, ['svg'], { backgroundColor: '#ff00ff' });
    expect(result.svg).toContain('fill="#ff00ff"');
  });

  it('never draws label text with a stroke, which would cover the glyphs', async () => {
    const result = await renderDiagram(SOURCE, ['svg'], { theme: 'light' });
    // The group stroke must not reach the label. The rule scopes it to shapes.
    expect(result.svg).not.toMatch(/\.node\s*\{[^}]*stroke:/);
    expect(result.svg).toMatch(/\.node text\s*\{[^}]*stroke:\s*none/);
  });

  it('renders a dark theme PNG that is dark, not blank or inverted', async () => {
    const result = await renderDiagram(SOURCE, ['png'], { theme: 'dark', width: 800 });
    expect(result.png).toBeDefined();

    const { channels } = await sharp(result.png as Buffer).stats();
    const [red, green, blue] = channels.slice(0, 3).map((c) => c.mean);
    // A dark canvas keeps every channel low. A blank white export would not.
    expect(red).toBeLessThan(80);
    expect(green).toBeLessThan(80);
    expect(blue).toBeLessThan(80);
  });

  it('renders a light theme PNG that is light', async () => {
    const result = await renderDiagram(SOURCE, ['png'], { theme: 'light', width: 800 });
    const { channels } = await sharp(result.png as Buffer).stats();
    const [red, green, blue] = channels.slice(0, 3).map((c) => c.mean);
    expect(red).toBeGreaterThan(180);
    expect(green).toBeGreaterThan(180);
    expect(blue).toBeGreaterThan(180);
  });

  it('keeps enough contrast between the ink and the canvas in every theme', async () => {
    for (const theme of THEMES) {
      const result = await renderDiagram(SOURCE, ['png'], { theme, width: 800 });
      const { channels } = await sharp(result.png as Buffer).stats();
      // A flat export has a near-zero standard deviation. Real content varies.
      const spread = Math.max(...channels.slice(0, 3).map((c) => c.stdev));
      expect(spread, `theme ${theme} produced a flat image`).toBeGreaterThan(5);
    }
  });

  it('produces an opaque JPEG, which holds no alpha channel', async () => {
    const result = await renderDiagram(SOURCE, ['jpeg'], { theme: 'dark', width: 800 });
    const { isOpaque, channels } = await sharp(result.jpeg as Buffer).stats();
    expect(isOpaque).toBe(true);
    // A flattened dark canvas must not turn white.
    expect(channels[0].mean).toBeLessThan(80);
  });
});

describe('HTML viewer supply chain', () => {
  it('loads no third-party script at all', async () => {
    const result = await renderDiagram(SOURCE, ['html'], { theme: 'light' });
    const html = result.html as string;

    // The viewer used to pull pan-zoom and a raster library from a CDN. The
    // host could then change the code inside a diagram already shared, and the
    // file broke with no network. Both are now built in.
    expect(html.match(/<script[^>]+src=/g) ?? []).toEqual([]);
    expect(html).not.toContain('unpkg.com');
  });
});
