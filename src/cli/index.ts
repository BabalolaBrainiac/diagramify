#!/usr/bin/env node
import { program } from 'commander';
import { generateCommand } from './commands/generate.js';
import { renderCommand } from './commands/render.js';
import { initCommand } from './commands/init.js';
import { previewCommand } from './commands/preview.js';
import { makeDiffCommand } from './commands/diff.js';
import { makeCICommand } from './commands/ci.js';

program
  .name('diagramify')
  .description('AI-powered Mermaid diagram generator')
  .version('0.2.1');

program.addCommand(generateCommand);
program.addCommand(renderCommand);
program.addCommand(previewCommand);
program.addCommand(initCommand);
program.addCommand(makeDiffCommand());
program.addCommand(makeCICommand());

program.parse(process.argv);
