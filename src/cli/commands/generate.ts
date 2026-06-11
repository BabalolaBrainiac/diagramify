import { Command } from 'commander';
import { writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { generateDiagram } from '../../core/generate.js';
import type { GenerateOptions, OutputFormat, DiagramType } from '../../core/types.js';

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
  .option('--out <formats>', 'Comma-separated output formats: svg,png,jpeg,html,mmd (default: svg,html,mmd)')
  .option('--outdir <dir>', 'Output directory (default: current directory)')
  .option('--name <name>', 'Base filename for outputs (default: diagram)')
  .option('--theme <theme>', 'Diagram theme name')
  .option('--dark', 'Use dark mode theme')
  .option('--provider <name>', 'LLM provider: anthropic|openai|google')
  .option('--model <id>', 'Model ID override')
  .option('--direction <dir>', 'Flow direction: LR, TD, TB, RL (default: LR)')
  .option('--stdout', 'Print Mermaid source to stdout instead of writing files')
  .option('--json', 'Output result as JSON with base64-encoded images')
  .action(async (options) => {
    try {
      const codebasePath = options.path ? resolve(options.path) : process.cwd();
      const outDir = options.outdir ? resolve(options.outdir) : process.cwd();
      const baseName = options.name || 'diagram';

      const formats = options.out
        ? options.out.split(',').map((f: string) => f.trim().toLowerCase())
        : ['svg', 'html', 'mmd'];

      const generateOptions: GenerateOptions = {
        input: options.description ? 'description' : 'codebase',
        path: options.description ? undefined : codebasePath,
        description: options.description,
        diagramType: options.type as DiagramType,
        config: {
          provider: options.provider,
          model: options.model,
          theme: options.theme,
          darkMode: options.dark ?? false,
          defaultOutput: formats as OutputFormat[],
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

        console.error(`\nTokens used: ${result.tokensUsed}`);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
