import { Command } from 'commander';
import { basename as pathBasename, resolve } from 'path';
import { analyzeCodebase } from '../../core/analyze.js';
import { analysisToGraph } from '../../core/ir-analyzer.js';
import { buildSpatialModel, renderSpatialHTML } from '../../core/spatial/engine.js';
import { extractStateMachines, renderStatechartHTML, verifyStateMachine } from '../../core/statechart/engine.js';
import { scanStatechartSources } from '../../core/statechart/scan.js';

/** Serves the live interactive viewer and simulator without touching preview. */
export const interactiveCommand = new Command()
  .name('interactive')
  .description('Serve the live spatial model and statechart simulator over HTTP')
  .argument('[path]', 'Path to codebase root (default: current directory)')
  .option('--port <number>', 'Local server port', '3000')
  .action(async (pathArg: string | undefined, options) => {
    try {
      const port = Number(options.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Select a valid server port.');
      const root = pathArg ? resolve(pathArg) : process.cwd();

      const analysis = await analyzeCodebase(root);
      const graph = analysisToGraph(analysis, { title: pathBasename(root), direction: 'LR' });
      if (!graph.nodes.length) throw new Error('The analysis found no components to model.');

      const spatialHTML = renderSpatialHTML(buildSpatialModel(graph), { title: graph.title ?? pathBasename(root) });

      const machines = extractStateMachines(await scanStatechartSources(root));
      const statechartHTML = machines.length
        ? renderStatechartHTML(machines[0], verifyStateMachine(machines[0]))
        : undefined;

      const { default: express } = await import('express');
      const { createServer } = await import('node:http');
      const app = express();

      app.disable('x-powered-by');
      app.get('/', (_request, response) => {
        response.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Diagramify interactive</title><style>body{margin:0;font:14px/1.5 system-ui,sans-serif;background:#0a0a0f;color:#e2e8f0}main{max-width:560px;margin:48px auto;padding:0 16px}a{color:#16aab9;display:block;padding:12px 0;border-bottom:1px solid #2a2a3a;text-decoration:none}a:hover{color:#ff6b00}</style></head><body><main><h1>Diagramify interactive</h1><a href="/spatial">Spatial model</a><a href="/statechart">Statechart simulator</a></main></body></html>`);
      });
      app.get('/spatial', (_request, response) => {
        response.type('html').send(spatialHTML);
      });
      app.get('/statechart', (_request, response) => {
        if (!statechartHTML) {
          response.status(404).type('text').send('No runtime state machine was found in the sources.');
          return;
        }
        response.type('html').send(statechartHTML);
      });
      app.use((_request, response) => {
        response.status(404).type('text').send('Not found.');
      });

      const server = createServer(app);
      await new Promise<void>((accept, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => accept());
      });
      console.error(`Interactive server listening on http://127.0.0.1:${port}/`);
      console.error('  /spatial     tiered 3D model');
      if (statechartHTML) console.error('  /statechart  verified statechart simulator');
      else console.error('  /statechart  unavailable: no state machine found');
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
