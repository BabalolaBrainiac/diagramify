import { Command } from 'commander';
import { readFileSync, watch as fsWatch } from 'fs';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { renderDiagram } from '../../core/render.js';
import { generateInteractiveHTML } from '../../core/html.js';

const INJECTED_RELOAD_SCRIPT = `
<script>
(function() {
  const ws = new WebSocket('ws://localhost:__PORT__');
  ws.onmessage = () => window.location.reload();
  ws.onclose = () => setTimeout(() => window.location.reload(), 2000);
})();
</script>`;

export const watchCommand = new Command()
  .name('watch')
  .description(
    'Watch a .mmd file and hot-reload an HTML preview in the browser on every save. ' +
    'Lightweight alternative to `preview` — no Express, just HTTP + WebSocket. ' +
    'Use `preview` for the interactive editor / POST API workflow.',
  )
  .argument('<file>', 'Path to the .mmd file to watch')
  .option('--port <n>', 'HTTP preview server port', '3055')
  .option('--theme <theme>', 'Diagram theme', 'light')
  .option('--outdir <dir>', 'Directory to write the live HTML file (default: same as input file)')
  .option('--open', 'Open the browser automatically on start')
  .action(async (file: string, options: Record<string, string>) => {
    const filePath = resolve(file);
    const port = parseInt(options.port || '3055', 10);
    const wsPort = port + 1;
    const outDir = options.outdir ? resolve(options.outdir) : dirname(filePath);
    const htmlPath = join(outDir, 'watch-preview.html');

    mkdirSync(outDir, { recursive: true });

    // WebSocket server for hot reload
    const wss = new WebSocketServer({ port: wsPort });
    const broadcast = () => wss.clients.forEach(c => { if (c.readyState === 1) c.send('reload'); });

    async function render() {
      try {
        const source = readFileSync(filePath, 'utf-8');
        const rendered = await renderDiagram(source, ['svg'], { theme: options.theme });
        if (!rendered.svg) return;
        const html = generateInteractiveHTML(rendered.svg, source, { theme: options.theme, title: `Watch: ${file}` });
        const withReload = html.replace('</body>', INJECTED_RELOAD_SCRIPT.replace('__PORT__', String(wsPort)) + '\n</body>');
        writeFileSync(htmlPath, withReload);
        console.error(`[diagramify watch] Rendered → ${htmlPath}`);
        broadcast();
      } catch (err: unknown) {
        console.error('[diagramify watch] Render error:', err instanceof Error ? err.message : String(err));
      }
    }

    // HTTP server to serve the preview HTML
    const httpServer = createServer((req, res) => {
      try {
        const html = readFileSync(htmlPath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch {
        res.writeHead(404);
        res.end('Preview not ready yet — waiting for first render...');
      }
    });

    httpServer.listen(port, () => {
      const url = `http://localhost:${port}`;
      console.error(`\n  🔭  diagramify watch`);
      console.error(`  ──────────────────────────────`);
      console.error(`  Watching : ${filePath}`);
      console.error(`  Preview  : ${url}`);
      console.error(`  Hot-reload WebSocket on :${wsPort}`);
      console.error(`  Press Ctrl+C to stop\n`);
      if (options.open) {
        const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        import('child_process').then(({ exec }) => { exec(`${openCmd} ${url}`); }).catch(() => {});
      }
    });

    // Initial render
    await render();

    // Watch for file changes
    let debounce: ReturnType<typeof setTimeout> | null = null;
    fsWatch(filePath, () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(render, 150);
    });
  });
