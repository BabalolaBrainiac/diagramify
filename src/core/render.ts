import sharp from 'sharp';
import { renderMermaidSVG, THEMES } from 'beautiful-mermaid';
import { generateInteractiveHTML } from './html.js';
import { styleSVG } from './styling/renderer.js';
import { getTheme } from './styling/themes.js';
import type { DiagramifyResult, OutputFormat, RenderOptions, DiagramType } from './types.js';

const themePalette: Record<string, { bg: string; fg: string; line: string; accent: string }> = {
  light:         { bg: '#ffffff', fg: '#0f172a', line: '#94a3b8', accent: '#3b82f6' },
  dark:          { bg: '#0a0a0f', fg: '#e2e8f0', line: '#475569', accent: '#60a5fa' },
  'tokyo-night': { bg: '#1a1b26', fg: '#c0caf5', line: '#565f89', accent: '#7aa2f7' },
  nord:          { bg: '#2e3440', fg: '#eceff4', line: '#4c566a', accent: '#88c0d0' },
  catppuccin:    { bg: '#1e1e2e', fg: '#cdd6f4', line: '#45475a', accent: '#cba6f7' },
};

function applyThemeVars(svg: string, themeName?: string, darkMode?: boolean): string {
  const key = themeName && themePalette[themeName] ? themeName : darkMode ? 'dark' : 'light';
  const p = themePalette[key];
  if (/<svg[^>]*\sstyle="/.test(svg)) {
    return svg.replace(
      /<svg([^>]*)\sstyle="[^"]*"/,
      `<svg$1 style="--bg:${p.bg};--fg:${p.fg};--line:${p.line};--accent:${p.accent};background:var(--bg)"`,
    );
  }
  return svg.replace(
    /<svg([^>]*?)>/,
    `<svg$1 style="--bg:${p.bg};--fg:${p.fg};--line:${p.line};--accent:${p.accent};background:var(--bg)">`,
  );
}

function detectDiagramType(mermaidSource: string): DiagramType {
  const source = mermaidSource.trim().toLowerCase();

  if (source.startsWith('flowchart') || source.startsWith('graph')) {
    return 'flowchart';
  }
  if (source.startsWith('sequencediagram')) {
    return 'sequence';
  }
  if (source.startsWith('classDiagram')) {
    return 'class';
  }
  if (source.startsWith('erDiagram')) {
    return 'er';
  }
  if (source.startsWith('stateDiagram')) {
    return 'state';
  }
  if (source.startsWith('xychart-beta')) {
    return 'xychart';
  }

  return 'auto';
}

function renderSVG(mermaidSource: string, theme?: string, darkMode: boolean = false): string {
  const themeConfig = theme && theme in THEMES ? THEMES[theme as keyof typeof THEMES] : undefined;

  try {
    let svg = renderMermaidSVG(mermaidSource, themeConfig);
    svg = applyThemeVars(svg, theme, darkMode);

    const diagramTheme = getTheme(theme, darkMode ? 'dark' : 'light');
    svg = styleSVG(svg, diagramTheme);

    return svg;
  } catch (error) {
    throw new Error(`Failed to render SVG: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function rasterize(
  svgString: string,
  format: 'png' | 'jpeg',
  options: { width?: number; quality?: number } = {},
): Promise<Buffer> {
  const width = options.width ?? 1200;
  const quality = options.quality ?? 90;

  const pipeline = sharp(Buffer.from(svgString)).resize(width, undefined, {
    withoutEnlargement: true,
  });

  if (format === 'jpeg') {
    return pipeline.jpeg({ quality }).toBuffer();
  }

  return pipeline.png().toBuffer();
}

export async function renderDiagram(
  mermaidSource: string,
  formats: OutputFormat[],
  options: RenderOptions = {},
): Promise<Omit<DiagramifyResult, 'tokensUsed'>> {
  const result: Omit<DiagramifyResult, 'tokensUsed'> = {
    mermaid: mermaidSource,
    diagramType: detectDiagramType(mermaidSource),
  };

  if (formats.includes('svg') || formats.includes('png') || formats.includes('jpeg') || formats.includes('html')) {
    try {
      const rawSVG = renderMermaidSVG(mermaidSource);
      const baseSVG = applyThemeVars(rawSVG, options.theme, options.darkMode ?? false);

      if (formats.includes('html')) {
        try {
          const html = generateInteractiveHTML(baseSVG, mermaidSource, options);
          result.html = html;
        } catch (error) {
          throw new Error(`HTML generation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (formats.includes('svg') || formats.includes('png') || formats.includes('jpeg')) {
        result.svg = renderSVG(mermaidSource, options.theme, options.darkMode ?? false);
      }
    } catch (error) {
      throw new Error(`SVG rendering failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (formats.includes('png') && result.svg) {
    try {
      result.png = await rasterize(result.svg, 'png', { width: options.width });
    } catch (error) {
      throw new Error(`PNG rasterization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (formats.includes('jpeg') && result.svg) {
    try {
      result.jpeg = await rasterize(result.svg, 'jpeg', { width: options.width, quality: options.quality });
    } catch (error) {
      throw new Error(
        `JPEG rasterization failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return result;
}
