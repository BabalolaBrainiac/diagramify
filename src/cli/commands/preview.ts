import { Command } from 'commander';
import { resolve } from 'node:path';

export const previewCommand = new Command()
  .name('preview')
  .description('Preview a shared graph with live file updates and an agent API')
  .option('--file <path>', 'Path to a Mermaid file to watch')
  .option('--port <number>', 'Local server port', '3000')
  .option('--theme <theme>', 'Diagram theme')
  .option('--open', 'Open the browser')
  .action(async options => {
    const [{ runPreview }, { loadConfig }] = await Promise.all([
      import('../preview-runner.js'),
      import('../../core/config.js'),
    ]);
    const config = await loadConfig({ theme: options.theme });
    await runPreview({ file: options.file ? resolve(options.file) : undefined,
      port: Number(options.port), theme: config.theme, open: options.open });
  });
