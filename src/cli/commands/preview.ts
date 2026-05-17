import { Command } from 'commander';
import { readFileSync, watch } from 'fs';
import { resolve } from 'path';
import express from 'express';
import { renderDiagram } from '../../core/render.js';
import { loadConfig } from '../../core/config.js';

let currentHtml = '';
let currentMermaid = '';

async function renderFile(filePath: string, theme?: string): Promise<void> {
  try {
    const mermaidSource = readFileSync(filePath, 'utf-8');
    const config = await loadConfig({ theme });
    const result = await renderDiagram(mermaidSource, ['html'], { theme: config.theme });

    if (result.html) {
      currentHtml = result.html;
      currentMermaid = mermaidSource;
      console.log(`[${new Date().toLocaleTimeString()}] Rendered: ${filePath}`);
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
  .description('Start a dev server for live diagram preview')
  .option('--file <path>', 'Path to .mmd file to preview')
  .option('--port <number>', 'Server port (default: 3000)', '3000')
  .option('--theme <theme>', 'Diagram theme')
  .option('--open', 'Open browser automatically')
  .action(async (options) => {
    const port = parseInt(options.port, 10);
    let filePath = options.file ? resolve(options.file) : undefined;

    if (!filePath) {
      console.log('Interactive preview mode');
      console.log('Upload or paste Mermaid source to preview diagrams');
      currentMermaid = `flowchart TD
    A[Start] --> B[Process]
    B --> C[End]`;
    } else {
      await renderFile(filePath, options.theme);

      watch(filePath, async () => {
        await renderFile(filePath, options.theme);
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
          currentHtml = result.html;
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

    const server = app.listen(port, () => {
      const url = `http://localhost:${port}`;
      console.log(`Preview server running at ${url}`);
      console.log(`Keyboard shortcuts:`);
      console.log(`  + : Zoom in`);
      console.log(`  - : Zoom out`);
      console.log(`  0 : Reset view`);
      console.log(`  Mouse drag : Pan`);
      console.log(`  Mouse scroll : Zoom`);

      if (filePath) {
        console.log(`\nWatching: ${filePath}`);
        console.log('Diagram updates automatically on file changes');
      } else {
        console.log(
          `\nNo file specified. Use --file <path> to watch a .mmd file, or POST to /api/update to update the diagram`,
        );
      }

      if (options.open) {
        const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        import('child_process').then(({ exec }) => {
          exec(`${openCmd} ${url}`);
        });
      }
    });

    process.on('SIGINT', () => {
      console.log('\nShutting down...');
      server.close(() => process.exit(0));
    });
  });
