import { Command } from 'commander';
import { mkdirSync, writeFileSync } from 'fs';
import { basename as pathBasename, join, resolve } from 'path';
import { extractStateMachines, statechartOutputs, verifyStateMachine } from '../../core/statechart/engine.js';
import { scanStatechartSources } from '../../core/statechart/scan.js';

const FORMATS = new Set(['svg', 'png', 'html']);

export const statechartCommand = new Command()
  .name('statechart')
  .description('Extract runtime state machines, verify them, and render statecharts')
  .argument('[path]', 'Path to codebase root (default: current directory)')
  .option('--out <formats>', 'Output formats: svg,png,html (default: svg,html)', 'svg,html')
  .option('--outdir <dir>', 'Output directory (default: current directory)')
  .option('--name <name>', 'Base filename for outputs (default: statechart)')
  .action(async (pathArg: string | undefined, options) => {
    try {
      const root = pathArg ? resolve(pathArg) : process.cwd();
      const formats = options.out.split(',').map((f: string) => f.trim().toLowerCase())
        .filter((f: string) => {
          if (FORMATS.has(f)) return true;
          throw new Error(`Unsupported format "${f}". Use: ${[...FORMATS].join(', ')}.`);
        });

      const sources = await scanStatechartSources(root);
      const machines = extractStateMachines(sources);
      if (!machines.length) throw new Error('No runtime state machine was found in the sources.');

      const outDir = options.outdir ? resolve(options.outdir) : process.cwd();
      mkdirSync(outDir, { recursive: true });

      machines.forEach((machine) => {
        const verification = verifyStateMachine(machine);
        const report = verification.checks
          .map((c) => `${c.passed ? 'PASS' : 'FAIL'} ${c.id} — ${c.detail}`)
          .join('\n');
        console.error(`\n${machine.name}: ${verification.passed ? 'verified' : 'violations found'}\n${report}`);
        if (machine.workerCount !== undefined) console.error(`worker bound: ${machine.workerCount}`);
        if (machine.signals?.length) console.error(`signal traps: ${machine.signals.join(', ')}`);
      });

      for (const [index, machine] of machines.entries()) {
        const verification = verifyStateMachine(machine);
        const result = await statechartOutputs(machine, formats, verification);
        const baseName = pathBasename(options.name || 'statechart') || 'statechart';
        const suffix = machines.length === 1 ? '' : `-${machine.name || index}`;
        for (const format of formats) {
          const value = result[format as keyof typeof result];
          if (!value) continue;
          const file = join(outDir, `${baseName}${suffix}.${format}`);
          writeFileSync(file, value as string | Buffer);
          console.error(`Generated: ${file}`);
        }
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
