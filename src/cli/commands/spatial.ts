import { Command } from 'commander';
import { mkdirSync, writeFileSync } from 'fs';
import { basename as pathBasename, join, resolve } from 'path';
import { analyzeCodebase } from '../../core/analyze.js';
import { analysisToGraph } from '../../core/ir-analyzer.js';
import { spatialOutputs, type SpatialChassis, type SpatialElevation, type SpatialThemeName } from '../../core/spatial/engine.js';

const ELEVATIONS = new Set(['stacked', 'exploded']);
const CHASSIS = new Set(['integrated', 'open-frame']);
const THEMES = new Set(['forge', 'dark', 'nord']);
const FORMATS = new Set(['svg', 'png', 'html']);

function pick(value: string | undefined, allowed: Set<string>, flag: string): string | undefined {
  if (!value) return undefined;
  if (!allowed.has(value)) throw new Error(`Unsupported --${flag} value "${value}". Use one of: ${[...allowed].join(', ')}.`);
  return value;
}

export const spatialCommand = new Command()
  .name('spatial')
  .description('Render the analyzed architecture as a tiered 3D spatial model')
  .argument('[path]', 'Path to codebase root (default: current directory)')
  .option('--elevation <mode>', 'Tier spacing: stacked | exploded', 'stacked')
  .option('--chassis <style>', 'Plate style: integrated | open-frame', 'integrated')
  .option('--theme <name>', 'Palette: forge | dark | nord', 'forge')
  .option('--out <formats>', 'Output formats: svg,png,html (default: svg,html)', 'svg,html')
  .option('--outdir <dir>', 'Output directory (default: current directory)')
  .option('--name <name>', 'Base filename for outputs (default: spatial)')
  .action(async (pathArg: string | undefined, options) => {
    try {
      const root = pathArg ? resolve(pathArg) : process.cwd();
      const elevation = pick(options.elevation, ELEVATIONS, 'elevation') as SpatialElevation;
      const chassis = pick(options.chassis, CHASSIS, 'chassis') as SpatialChassis;
      const theme = pick(options.theme, THEMES, 'theme') as SpatialThemeName;
      const formats = options.out.split(',').map((f: string) => f.trim().toLowerCase())
        .filter((f: string) => {
          if (FORMATS.has(f)) return true;
          throw new Error(`Unsupported format "${f}". Use: ${[...FORMATS].join(', ')}.`);
        });

      const analysis = await analyzeCodebase(root);
      const graph = analysisToGraph(analysis, { title: pathBasename(root), direction: 'LR' });
      if (!graph.nodes.length) throw new Error('The analysis found no components to model.');

      const result = await spatialOutputs(graph, formats, { elevation, chassis, theme });
      const outDir = options.outdir ? resolve(options.outdir) : process.cwd();
      const baseName = pathBasename(options.name || 'spatial') || 'spatial';
      mkdirSync(outDir, { recursive: true });

      for (const format of formats) {
        const value = result[format as keyof typeof result];
        if (!value) continue;
        const file = join(outDir, `${baseName}.${format}`);
        writeFileSync(file, value as string | Buffer);
        console.error(`Generated: ${file}`);
      }

      console.error(`${graph.nodes.length} modules placed on the tier stack.`);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
