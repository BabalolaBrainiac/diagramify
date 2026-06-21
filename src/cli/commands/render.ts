import { Command } from 'commander';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { renderDiagram } from '../../core/render.js';
import type { OutputFormat, RenderOptions } from '../../core/types.js';

const VALID_OUTPUT_FORMATS = new Set<OutputFormat>(['svg', 'png', 'jpeg', 'html', 'mmd']);

function parseOutputFormats(value: string | undefined, defaults: OutputFormat[]): OutputFormat[] {
  const formats = value
    ? value.split(',').map((f: string) => f.trim().toLowerCase()).filter(Boolean)
    : defaults;

  const invalid = formats.filter((format) => !VALID_OUTPUT_FORMATS.has(format as OutputFormat));
  if (invalid.length > 0) {
    throw new Error(
      `Unsupported output format${invalid.length === 1 ? '' : 's'}: ${invalid.join(', ')}. ` +
      `Supported formats: ${Array.from(VALID_OUTPUT_FORMATS).join(', ')}`,
    );
  }

  return formats as OutputFormat[];
}

export const renderCommand = new Command()
  .name('render')
  .description('Render an existing .mmd file to SVG, PNG, JPEG, HTML, or Mermaid source')
  .argument('<input>', 'Path to .mmd file or "-" for stdin')
  .option('--out <formats>', 'Output formats: svg,png,jpeg,html,mmd (default: svg,html)')
  .option('--outdir <dir>', 'Output directory (default: current directory)')
  .option('--name <name>', 'Output filename (default: diagram)')
  .option('--theme <theme>', 'Diagram theme name')
  .option('--dark', 'Use dark mode theme')
  .option('--width <px>', 'Output width in pixels (default: 1200)', '1200')
  .option('--quality <1-100>', 'JPEG quality (default: 90)', '90')
  .option('--stdout', 'Print SVG to stdout instead of writing files')
  .action(async (inputPath: string, options) => {
    try {
      let mermaidSource = '';

      if (inputPath === '-') {
        const chunks: string[] = [];
        process.stdin.setEncoding('utf-8');

        for await (const chunk of process.stdin) {
          chunks.push(chunk);
        }

        mermaidSource = chunks.join('');
      } else {
        const filePath = resolve(inputPath);
        mermaidSource = readFileSync(filePath, 'utf-8');
      }

      const formats = parseOutputFormats(options.out, ['svg', 'html']);

      const renderOptions: RenderOptions = {
        theme: options.theme,
        width: parseInt(options.width, 10),
        quality: parseInt(options.quality, 10),
        darkMode: options.dark ?? false,
      };

      console.error('Rendering diagram...');
      const result = await renderDiagram(mermaidSource, formats, renderOptions);

      if (options.stdout) {
        if (result.svg) {
          console.log(result.svg);
        }
      } else {
        const outDir = options.outdir ? resolve(options.outdir) : process.cwd();
        const baseName = options.name || 'diagram';

        mkdirSync(outDir, { recursive: true });

        if (formats.includes('svg') && result.svg) {
          const svgPath = join(outDir, `${baseName}.svg`);
          writeFileSync(svgPath, result.svg);
          console.error(`Generated: ${svgPath}`);
        }

        if (formats.includes('png') && result.png) {
          const pngPath = join(outDir, `${baseName}.png`);
          writeFileSync(pngPath, result.png);
          console.error(`Generated: ${pngPath}`);
        }

        if (formats.includes('jpeg') && result.jpeg) {
          const jpegPath = join(outDir, `${baseName}.jpeg`);
          writeFileSync(jpegPath, result.jpeg);
          console.error(`Generated: ${jpegPath}`);
        }

        if (formats.includes('html') && result.html) {
          const htmlPath = join(outDir, `${baseName}.html`);
          writeFileSync(htmlPath, result.html);
          console.error(`Generated: ${htmlPath}`);
          console.error(`Open in browser: file://${htmlPath}`);
        }

        if (formats.includes('mmd')) {
          const mmdPath = join(outDir, `${baseName}.mmd`);
          writeFileSync(mmdPath, result.mermaid);
          console.error(`Generated: ${mmdPath}`);
        }
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
