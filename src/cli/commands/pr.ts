import { Command } from 'commander';
import { resolve } from 'path';
import type { PrDiffMode } from '../../core/pr-diff.js';
import type { OutputFormat } from '../../core/types.js';

const VALID_OUTPUT_FORMATS = new Set<OutputFormat>([
  'svg', 'png', 'jpeg', 'html', 'mmd', 'pdf', 'drawio', 'excalidraw', 'json',
]);

function parseFormats(raw: string | undefined): OutputFormat[] | undefined {
  if (!raw) return undefined;
  const list = raw.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  const invalid = list.filter((f) => !VALID_OUTPUT_FORMATS.has(f as OutputFormat));
  if (invalid.length > 0) {
    throw new Error(`Unsupported output format: ${invalid.join(', ')}`);
  }
  return list as OutputFormat[];
}

export function makePrCommand(): Command {
  return new Command('pr')
    .description('Generate an architecture and state-machine diff for a pull request')
    .argument('[prId]', 'Pull request number (optional when --base and --head are set)')
    .option('--path <dir>', 'Path to git repository root (default: current directory)')
    .option('--base <ref>', 'Base git ref (branch or commit SHA)')
    .option('--head <ref>', 'Head git ref (branch or commit SHA)')
    .option('--mode <mode>', 'Diff focus: auto | arch | state', 'auto')
    .option('--max-nodes <n>', 'Maximum nodes in the focused diagram', '24')
    .option('--out <formats>', 'Optional artifact formats: svg,png,html,mmd,pdf,drawio,excalidraw,json')
    .option('--outdir <dir>', 'Output directory for rendered artifacts', './diagrams')
    .option('--name <name>', 'Base filename for rendered artifacts')
    .option('--theme <theme>', 'Theme name for rendered artifacts')
    .option('--no-update', 'Do not edit the pull request description')
    .option('--dry-run', 'Compute and print output without editing the pull request')
    .option('--json', 'Print structured report as JSON')
    .action(async (prId: string | undefined, options) => {
      try {
        const mode = String(options.mode || 'auto').toLowerCase() as PrDiffMode;
        if (!['auto', 'arch', 'state'].includes(mode)) {
          throw new Error('Mode must be auto, arch, or state.');
        }

        const { runPrDiff } = await import('../../core/pr-diff.js');
        const { report, writtenFiles } = await runPrDiff({
          prId,
          repoPath: options.path ? resolve(options.path) : process.cwd(),
          baseRef: options.base,
          headRef: options.head,
          mode,
          maxNodes: Number.parseInt(options.maxNodes, 10) || 24,
          outFormats: parseFormats(options.out),
          outDir: options.outdir,
          name: options.name,
          theme: options.theme,
          update: Boolean(prId) && options.update !== false,
          dryRun: Boolean(options.dryRun),
        });

        if (options.json) {
          console.log(JSON.stringify({ report, writtenFiles }, null, 2));
          return;
        }

        console.log(report.markdown);
        if (writtenFiles.length > 0) {
          console.error(`Generated: ${writtenFiles.join(', ')}`);
        }
        if (report.updatedPrBody && report.prNumber) {
          console.error(`Updated description for PR #${report.prNumber}.`);
        }
      } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}
