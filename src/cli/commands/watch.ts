import { Command } from 'commander';
import { resolve, dirname, join } from 'node:path';
import { runPreview } from '../preview-runner.js';

export const watchCommand = new Command()
  .name('watch')
  .description('Watch a Mermaid file and update the viewer without reloading it')
  .argument('<file>', 'Path to the Mermaid file')
  .option('--port <number>', 'Local server port', '3055')
  .option('--theme <theme>', 'Diagram theme', 'light')
  .option('--outdir <dir>', 'Directory for watch-preview.html')
  .option('--open', 'Open the browser')
  .action(async (file, options) => {
    const path = resolve(file);
    await runPreview({ file: path, port: Number(options.port), theme: options.theme, open: options.open,
      output: join(options.outdir ? resolve(options.outdir) : dirname(path), 'watch-preview.html') });
  });
