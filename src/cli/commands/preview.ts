import { Command } from 'commander';
import { resolve } from 'node:path';
import { runPreview } from '../preview-runner.js';
import { loadConfig } from '../../core/config.js';

export const previewCommand = new Command()
  .name('preview')
  .description('Preview a shared graph with live file updates and an agent API')
  .option('--file <path>', 'Path to a Mermaid file to watch')
  .option('--port <number>', 'Local server port', '3000')
  .option('--theme <theme>', 'Diagram theme')
  .option('--open', 'Open the browser')
  .action(async options => {
    const config = await loadConfig({ theme: options.theme });
    await runPreview({ file: options.file ? resolve(options.file) : undefined,
      port: Number(options.port), theme: config.theme, open: options.open });
  });
