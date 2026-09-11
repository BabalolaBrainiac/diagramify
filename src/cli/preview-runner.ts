import { readFileSync, watch, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { createPreviewServer } from '../core/preview-server.js';

export async function runPreview(options: { file?: string; port: number; theme?: string; output?: string; open?: boolean }) {
  const source = options.file ? readFileSync(options.file, 'utf8') : 'flowchart LR\n Start[Start] --> Process[Process] --> End[End]';
  const server = await createPreviewServer({ source, port: options.port, theme: options.theme,
    onHTML: options.output ? html => {
      mkdirSync(dirname(options.output!), { recursive: true }); writeFileSync(options.output!, html);
    } : undefined,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher = options.file ? watch(dirname(options.file), (_event, filename) => {
    if (filename && filename.toString() !== basename(options.file!)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        void server.setSource(readFileSync(options.file!, 'utf8')).catch(() => {
          server.reportError(); console.error('The source update failed. The current diagram remains available.');
        });
      } catch { server.reportError(); console.error('The source file is unavailable.'); }
    }, 150);
  }) : undefined;
  console.error(`Preview: ${server.url}`);
  console.error(`Agent graph: ${server.url}/api/graph`);
  if (options.file) console.error(`Watching: ${options.file}`);
  console.error('Press Ctrl+C to stop.');
  if (options.open) {
    if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', server.url]);
    else execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [server.url]);
  }
  const close = () => { clearTimeout(timer); watcher?.close(); void server.close(); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
  return server;
}
