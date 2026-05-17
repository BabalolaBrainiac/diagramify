import sharp from 'sharp';
import { renderMermaidSVG, THEMES } from 'beautiful-mermaid';
import { generateInteractiveHTML } from './html.js';
import { styleSVG, addVisualEffects } from './styling/renderer.js';
import { getTheme } from './styling/themes.js';
import type { DiagramifyResult, OutputFormat, RenderOptions, DiagramType } from './types.js';

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

    // Apply enhanced professional styling
    const diagramTheme = getTheme(theme, darkMode ? 'dark' : 'light');
    svg = styleSVG(svg, diagramTheme);

    // Add visual effects for depth
    svg = addVisualEffects(svg);

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
      const baseSVG = renderMermaidSVG(mermaidSource);

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
