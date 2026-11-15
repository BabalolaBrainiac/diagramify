#!/usr/bin/env node
import { Command, program } from 'commander';
import { generateCommand } from './commands/generate.js';
import { renderCommand } from './commands/render.js';
import { initCommand } from './commands/init.js';
import { previewCommand } from './commands/preview.js';
import { watchCommand } from './commands/watch.js';
import { makeDiffCommand } from './commands/diff.js';
import { makeCICommand } from './commands/ci.js';
import { makePrCommand } from './commands/pr.js';
import { checkCommand } from './commands/check.js';
import { modelsCommand } from './commands/models.js';
import { spatialCommand } from './commands/spatial.js';
import { statechartCommand } from './commands/statechart.js';
import { interactiveCommand } from './commands/interactive.js';

program
  .name('diagramify')
  .description('Architecture mapping and rendering engine')
  .version('0.5.1');

program.addCommand(generateCommand);
program.addCommand(renderCommand);
program.addCommand(previewCommand);
program.addCommand(watchCommand);
program.addCommand(initCommand);
program.addCommand(makeDiffCommand());
program.addCommand(makeCICommand());
program.addCommand(makePrCommand());
program.addCommand(checkCommand);
program.addCommand(modelsCommand);
program.addCommand(spatialCommand);
program.addCommand(statechartCommand);
program.addCommand(interactiveCommand);

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
