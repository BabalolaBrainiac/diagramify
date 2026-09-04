import { Command } from 'commander';
import { writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { generateDiagram } from '../../core/generate.js';
import type { GenerateOptions, OutputFormat, DiagramType } from '../../core/types.js';

const VALID_OUTPUT_FORMATS = new Set<OutputFormat>([
  'svg', 'png', 'jpeg', 'html', 'mmd', 'pdf', 'drawio', 'excalidraw', 'json',
]);

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

export const generateCommand = new Command()
  .name('generate')
  .description('Analyze a codebase or description and generate a diagram')
  .option('--path <dir>', 'Path to codebase root (default: current directory)')
  .option('--description <text>', 'Natural language description instead of codebase analysis')
  .option(
    '--type <type>',
    'Diagram type: flowchart|sequence|class|er|state|auto (default: auto)',
    'auto',
  )
  .option(
    '--out <formats>',
    'Output formats: svg,png,jpeg,html,mmd,pdf,drawio,excalidraw,json (default: svg,html,mmd)',
  )
  .option('--outdir <dir>', 'Output directory (default: current directory)')
  .option('--name <name>', 'Base filename for outputs (default: diagram)')
  .option('--theme <theme>', 'Diagram theme name')
  .option('--dark', 'Use dark mode theme')
  .option('--background <color>', 'Background color, or "transparent" to keep the alpha channel')
  .option('--provider <name>', 'LLM provider: anthropic|openai|google')
  .option('--model <id>', 'Model ID override')
  .option('--direction <dir>', 'Flow direction: LR, TD, TB, RL (default: LR)')
  .option('--stdout', 'Print Mermaid source to stdout instead of writing files')
  .option('--json', 'Output result as JSON with base64-encoded images')
  .option(
    '--no-llm',
    'Build the diagram from the codebase alone. No provider, no network, no API key.',
  )
  .option('--offline', 'Same as --no-llm, and the HTML viewer makes no network request')
  .action(async (options) => {
    try {
      const codebasePath = options.path ? resolve(options.path) : process.cwd();
      const outDir = options.outdir ? resolve(options.outdir) : process.cwd();
      const baseName = options.name || 'diagram';

      const formats = parseOutputFormats(options.out, ['svg', 'html', 'mmd']);

      const generateOptions: GenerateOptions = {
        input: options.description ? 'description' : 'codebase',
        path: options.description ? undefined : codebasePath,
        description: options.description,
        diagramType: options.type as DiagramType,
        noLLM: options.llm === false || options.offline === true,
        config: {
          provider: options.provider,
          model: options.model,
          theme: options.theme,
          darkMode: options.dark ?? false,
          backgroundColor: options.background,
          offlineMode: options.offline === true,
          defaultOutput: formats,
          direction: options.direction as any,
        },
      };

      console.error('Generating diagram...');
      const result = await generateDiagram(generateOptions);

      if (options.json) {
        const jsonResult = {
          mermaid: result.mermaid,
          svg: result.svg,
          png: result.png ? result.png.toString('base64') : undefined,
          jpeg: result.jpeg ? result.jpeg.toString('base64') : undefined,
          diagramType: result.diagramType,
          tokensUsed: result.tokensUsed,
        };
        console.log(JSON.stringify(jsonResult, null, 2));
      } else if (options.stdout) {
        console.log(result.mermaid);
      } else {
        mkdirSync(outDir, { recursive: true });

        if (formats.includes('mmd')) {
          const mmdPath = join(outDir, `${baseName}.mmd`);
          writeFileSync(mmdPath, result.mermaid);
          console.error(`Generated: ${mmdPath}`);
        }

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
        }

        if (formats.includes('pdf') && result.pdf) {
          const pdfPath = join(outDir, `${baseName}.pdf`);
          writeFileSync(pdfPath, result.pdf);
          console.error(`Generated: ${pdfPath}`);
        }

        if (formats.includes('drawio') && result.drawio) {
          const drawioPath = join(outDir, `${baseName}.drawio`);
          writeFileSync(drawioPath, result.drawio);
          console.error(`Generated: ${drawioPath}`);
        }

        if (formats.includes('excalidraw') && result.excalidraw) {
          const excalidrawPath = join(outDir, `${baseName}.excalidraw`);
          writeFileSync(excalidrawPath, result.excalidraw);
          console.error(`Generated: ${excalidrawPath}`);
        }

        if (formats.includes('json') && result.json) {
          const jsonPath = join(outDir, `${baseName}.json`);
          writeFileSync(jsonPath, result.json);
          console.error(`Generated: ${jsonPath}`);
        }

        const nodeCount = result.graph?.nodes.length ?? 0;
        console.error(`\n${nodeCount} services mapped. Tokens used: ${result.tokensUsed}`);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
