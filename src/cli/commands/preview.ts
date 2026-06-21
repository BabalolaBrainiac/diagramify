import { Command } from 'commander';
import { readFileSync, watch } from 'fs';
import { resolve } from 'path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { renderDiagram } from '../../core/render.js';
import { loadConfig } from '../../core/config.js';

let currentHtml = '';
let currentMermaid = '';

// WebSocket clients for hot-reload push
let wss: InstanceType<typeof WebSocketServer> | null = null;
function broadcastReload() {
  wss?.clients.forEach((c) => {
    if (c.readyState === 1) c.send('reload');
  });
}

// Injected into rendered HTML to auto-reload when the server pushes a 'reload' message
function makeReloadScript(wsPort: number): string {
  return `<script>
(function() {
  const ws = new WebSocket('ws://localhost:${wsPort}');
  ws.onmessage = () => window.location.reload();
  ws.onclose = () => setTimeout(() => window.location.reload(), 2000);
})();
</script>`;
}

async function renderFile(filePath: string, theme?: string, wsPort?: number): Promise<void> {
  try {
    const mermaidSource = readFileSync(filePath, 'utf-8');
    const config = await loadConfig({ theme });
    const result = await renderDiagram(mermaidSource, ['html'], { theme: config.theme });

    if (result.html) {
      currentMermaid = mermaidSource;
      // Inject hot-reload script before </body> if watching a file
      currentHtml =
        wsPort != null
          ? result.html.replace('</body>', makeReloadScript(wsPort) + '\n</body>')
          : result.html;
      console.log(`[${new Date().toLocaleTimeString()}] Rendered: ${filePath}`);
      broadcastReload();
    }
  } catch (error) {
    console.error(
      `[${new Date().toLocaleTimeString()}] Error rendering ${filePath}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export const previewCommand = new Command()
  .name('preview')
  .description(
    'Interactive diagram editor — live-preview with hot-reload, upload Mermaid source via POST /api/update, ' +
    'or watch a .mmd file with --file. Use `watch` for a lighter-weight file-watch loop.',
  )
  .option('--file <path>', 'Path to .mmd file to preview (enables file watching + hot-reload)')
  .option('--port <number>', 'Server port (default: 3000)', '3000')
  .option('--theme <theme>', 'Diagram theme')
  .option('--open', 'Open browser automatically')
  .action(async (options) => {
    const port = parseInt(options.port, 10);
    const wsPort = port + 1;
    const filePath = options.file ? resolve(options.file) : undefined;

    // Set up WebSocket server for hot-reload (always on, for POST /api/update too)
    wss = new WebSocketServer({ port: wsPort });

    if (!filePath) {
      console.log('Interactive preview mode — no file specified.');
      console.log(`POST Mermaid source to /api/update, or use --file <path> to watch a .mmd file.\n`);
      currentMermaid = `flowchart TD
    A[Start] --> B[Process]
    B --> C[End]`;
    } else {
      await renderFile(filePath, options.theme, wsPort);

      watch(filePath, async () => {
        await renderFile(filePath, options.theme, wsPort);
      });
    }

    const app = express();
    app.use(express.text({ limit: '10mb' }));

    app.get('/', (req, res) => {
      if (currentHtml) {
        res.send(currentHtml);
      } else {
        res.send('<h1>No diagram loaded</h1><p>Visit /upload to add one</p>');
      }
    });

    app.post('/api/update', async (req, res) => {
      try {
        currentMermaid = req.body;
        const config = await loadConfig({ theme: options.theme });
        const result = await renderDiagram(currentMermaid, ['html'], { theme: config.theme });

        if (result.html) {
          currentHtml = result.html.replace('</body>', makeReloadScript(wsPort) + '\n</body>');
          broadcastReload();
          res.json({ success: true });
        } else {
          res.status(500).json({ error: 'Failed to render diagram' });
        }
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    app.get('/api/source', (req, res) => {
      res.send(currentMermaid);
    });

    const httpServer = createServer(app);
    httpServer.listen(port, () => {
      const url = `http://localhost:${port}`;
      console.log(`\n  🖼  diagramify preview`);
      console.log(`  ──────────────────────────────`);
      console.log(`  Preview  : ${url}`);
      console.log(`  Hot-reload WebSocket on :${wsPort}`);
      if (filePath) {
        console.log(`  Watching : ${filePath}`);
      } else {
        console.log(`  POST source to: ${url}/api/update`);
      }
      console.log(`  Press Ctrl+C to stop\n`);

      if (options.open) {
        const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        import('child_process').then(({ exec }) => { exec(`${openCmd} ${url}`); }).catch(() => {});
      }
    });

    process.on('SIGINT', () => {
      console.log('\nShutting down...');
      wss?.close();
      httpServer.close(() => process.exit(0));
    });
  });
