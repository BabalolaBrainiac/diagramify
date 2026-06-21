#!/usr/bin/env node
import { Command, program } from 'commander';
import { generateCommand } from './commands/generate.js';
import { renderCommand } from './commands/render.js';
import { initCommand } from './commands/init.js';
import { previewCommand } from './commands/preview.js';
import { watchCommand } from './commands/watch.js';
import { makeDiffCommand } from './commands/diff.js';
import { makeCICommand } from './commands/ci.js';

program
  .name('diagramify')
  .description('AI-powered Mermaid diagram generator')
  .version('0.2.1');

program.addCommand(generateCommand);
program.addCommand(renderCommand);
program.addCommand(previewCommand);
program.addCommand(watchCommand);
program.addCommand(initCommand);
program.addCommand(makeDiffCommand());
program.addCommand(makeCICommand());

// `dev` is a discoverable alias for `preview` — same options, clearer name for development workflows
const devCommand = new Command()
  .name('dev')
  .description(
    'Alias for `preview` — start the interactive dev server with hot-reload. ' +
    'Use --file <path> to watch a .mmd file, or omit it for the interactive upload mode.',
  )
  .allowUnknownOption()
  .action(() => {
    // Forward to preview by re-running with 'preview' swapped in
    const args = process.argv.slice(2);
    const idx = args.findIndex((a) => a === 'dev');
    if (idx !== -1) args.splice(idx, 1, 'preview');
    program.parse(['node', 'diagramify', ...args]);
  });
program.addCommand(devCommand);

program.parse(process.argv);
