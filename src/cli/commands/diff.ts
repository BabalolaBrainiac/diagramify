import { Command } from 'commander';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { parseMermaidSource } from '../../core/parse.js';
import { computeDiff, generateDiffHTML, generateDiffMermaid } from '../../core/diff.js';
import { renderDiagram } from '../../core/render.js';

export function makeDiffCommand(): Command {
  return new Command('diff')
    .description('Compare two Mermaid diagrams and visualize what changed')
    .argument('<before>', 'Path to the before .mmd file')
    .argument('<after>', 'Path to the after .mmd file')
    .option('-o, --out <formats>', 'Output formats (html,mmd,svg)', 'html')
    .option('--outdir <dir>', 'Output directory', './diagrams')
    .option('--name <name>', 'Output file base name', 'diff')
    .option('--theme <theme>', 'Theme name', 'light')
    .action(async (beforePath, afterPath, options) => {
      console.log(`Comparing ${beforePath} and ${afterPath}...`);
      
      const beforeSrc = await readFile(beforePath, 'utf8');
      const afterSrc = await readFile(afterPath, 'utf8');
      
      const beforeGraph = parseMermaidSource(beforeSrc);
      const afterGraph = parseMermaidSource(afterSrc);
      
      const diff = computeDiff(beforeGraph, afterGraph);
      
      console.log(`Diff stats: +${diff.stats.added} -${diff.stats.removed} ~${diff.stats.unchanged}`);
      
      const formats = options.out.split(',');
      await mkdir(options.outdir, { recursive: true });
      const diffSource = generateDiffMermaid(beforeGraph, diff);
      
      if (formats.includes('mmd')) {
        await writeFile(join(options.outdir, `${options.name}.mmd`), diffSource);
        console.log(`Wrote ${options.outdir}/${options.name}.mmd`);
      }
      
      if (formats.includes('html') || formats.includes('svg')) {
        const beforeRender = await renderDiagram(beforeSrc, ['svg'], { theme: options.theme });
        const afterRender = await renderDiagram(afterSrc, ['svg'], { theme: options.theme });
        const diffRender = await renderDiagram(diffSource, ['svg'], { theme: options.theme });
        
        if (formats.includes('html')) {
          const html = generateDiffHTML(diff, beforeRender.svg || '', afterRender.svg || '', { theme: options.theme });
          await writeFile(join(options.outdir, `${options.name}.html`), html);
          console.log(`Wrote ${options.outdir}/${options.name}.html`);
        }

        if (formats.includes('svg') && diffRender.svg) {
          await writeFile(join(options.outdir, `${options.name}.svg`), diffRender.svg);
          console.log(`Wrote ${options.outdir}/${options.name}.svg`);
        }
      }
    });
}
