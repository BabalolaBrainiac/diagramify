import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { analyzeCodebase } from '../../core/analyze.js';
import { analysisToGraph } from '../../core/ir-analyzer.js';
import { generateGraph } from '../../core/generate.js';
import { deserializeGraph, serializeGraph } from '../../core/ir.js';
import { compareGraphs, formatDriftReport } from '../../core/drift.js';
import { basename } from 'path';

/**
 * Fails a pull request when the committed diagram no longer matches the code.
 *
 * The check runs on the Architecture IR, not on an image, so it reports the
 * services that were added, removed, or rewired. It defaults to the analyzer,
 * which needs no API key, so it runs on any build agent.
 */
export const checkCommand = new Command()
  .name('check')
  .description('Compare the committed diagram against the code, and report drift')
  .option('--path <dir>', 'Path to codebase root (default: current directory)')
  .option('--baseline <file>', 'Committed IR file to compare against', 'diagrams/architecture.json')
  .option('--update', 'Write the current graph to the baseline instead of comparing')
  .option('--llm', 'Use the configured provider instead of the analyzer')
  .option('--json', 'Print the drift report as JSON')
  .action(async (options) => {
    try {
      const codebasePath = options.path ? resolve(options.path) : process.cwd();
      const baselinePath = resolve(options.baseline);

      const current = options.llm
        ? (await generateGraph({ input: 'codebase', path: codebasePath })).graph
        : analysisToGraph(await analyzeCodebase(codebasePath), {
            title: basename(codebasePath),
          });

      if (options.update) {
        mkdirSync(dirname(baselinePath), { recursive: true });
        writeFileSync(baselinePath, serializeGraph(current));
        console.log(`Wrote baseline: ${baselinePath}`);
        console.log(`${current.nodes.length} services, ${current.edges.length} connections.`);
        return;
      }

      if (!existsSync(baselinePath)) {
        console.error(`No baseline at ${baselinePath}.`);
        console.error('Run "diagramify check --update" to create one.');
        process.exit(1);
      }

      const baseline = deserializeGraph(readFileSync(baselinePath, 'utf-8'));
      const report = compareGraphs(baseline, current);

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatDriftReport(report, options.baseline));
      }

      // A non-zero code fails the build step, which is the whole point.
      if (report.hasDrift) {
        process.exit(1);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
