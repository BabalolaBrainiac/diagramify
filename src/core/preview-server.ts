import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { createGraphSession, identifyGraph, GraphConflictError, type GraphSnapshot } from './graph-session.js';
import { renderGraph } from './render.js';
import { mermaidToGraph, graphToMermaid } from './ir-mermaid.js';
import { liveClientScript } from './live-client.js';
import type { ArchitectureGraph } from './ir.js';
import { generateInteractiveHTML } from './html.js';

const MAX_BYTES = 2 * 1024 * 1024;
const revisionSchema = z.number().int().nonnegative();
const editSchema = z.object({ type: z.literal('edit'), expectedRevision: revisionSchema, graph: z.unknown() });

function writeJSON(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error('Request too large.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function localRequest(request: IncomingMessage, port: number): boolean {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
  if (!hosts.includes(request.headers.host ?? '')) return false;
  if (!request.headers.origin) return true;
  return request.headers.origin === `http://${request.headers.host}`;
}

/** Runs one local graph session for file watching and agent updates. */
export async function createPreviewServer(options: { source: string; port: number; theme?: string; onHTML?: (html: string) => void }) {
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error('Select a valid server port.');
  const initial = await renderGraph(mermaidToGraph(options.source), ['json'], { theme: options.theme, offlineMode: true });
  const session = createGraphSession(initial.graph);
  function buildHTML(graph: ArchitectureGraph) {
    const html = generateInteractiveHTML('', graphToMermaid(graph), { graph, theme: options.theme, offlineMode: true });
    const end = html.lastIndexOf('</body>');
    return html.slice(0, end) + liveClientScript() + html.slice(end);
  }
  let currentHTML = buildHTML(session.read().graph);
  let port = options.port;
  let queue: Promise<unknown> = Promise.resolve();
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_BYTES });
  const requests = new Map<string, { count: number; start: number }>();
  const serialize = <T>(action: () => Promise<T>): Promise<T> => {
    const result = queue.then(action); queue = result.catch(() => undefined); return result;
  };
  function rateLimit(address: string) {
    const now = Date.now();
    const state = requests.get(address);
    if (!state || now - state.start > 60000) { requests.set(address, { count: 1, start: now }); return false; }
    return ++state.count > 300;
  }
  function broadcast(snapshot: GraphSnapshot, exclude?: WebSocket, type = 'graph') {
    const message = JSON.stringify({ type, ...snapshot });
    for (const client of sockets.clients) if (client !== exclude && client.readyState === WebSocket.OPEN) client.send(message);
  }
  async function publish(graph: ArchitectureGraph, expectedRevision: number, sourceUpdate = false) {
    if (expectedRevision !== session.getRevision()) throw new GraphConflictError(session.getRevision());
    const document = identifyGraph(graph);
    const incoming = document.nodes.every(node => node.layout) ? document :
      (await renderGraph(document, ['json'], { theme: options.theme })).graph!;
    const candidate = sourceUpdate ? session.previewReplacement(incoming, expectedRevision) : incoming;
    const html = buildHTML(candidate);
    options.onHTML?.(html);
    const snapshot = sourceUpdate ? session.replace(incoming, expectedRevision) : session.commit(candidate, expectedRevision);
    currentHTML = html;
    return snapshot;
  }
  async function setSource(source: string, expectedRevision?: number) {
    return serialize(async () => {
      const graph = mermaidToGraph(source);
      const previous = new Map(session.read().graph.nodes.map(node => [node.id, node]));
      for (const node of graph.nodes) node.layout = previous.get(node.id)?.layout;
      const snapshot = await publish(graph, expectedRevision ?? session.getRevision(), true);
      broadcast(snapshot); return snapshot;
    });
  }
  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (!localRequest(request, port)) { writeJSON(response, 403, { error: 'Request denied.' }); return; }
    if (rateLimit(request.socket.remoteAddress ?? 'local')) { writeJSON(response, 429, { error: 'Too many requests.' }); return; }
    const path = request.url?.split('?')[0];
    if (request.method === 'GET' && path === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(currentHTML); return;
    }
    if (request.method === 'GET' && path === '/api/graph') { writeJSON(response, 200, session.read()); return; }
    if (request.method === 'GET' && path === '/api/source') {
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end(graphToMermaid(session.read().graph)); return;
    }
    if (request.method !== 'POST' || !['/api/update', '/api/operations'].includes(path ?? '')) {
      writeJSON(response, 404, { error: 'Route not found.' }); return;
    }
    const before = session.getRevision();
    const body = await readBody(request);
    const snapshot = path === '/api/update' ? await setSource(body, before) : await serialize(async () => {
      const parsed = z.object({ expectedRevision: revisionSchema, operations: z.array(z.unknown()) }).parse(JSON.parse(body));
      if (parsed.expectedRevision !== session.getRevision()) throw new GraphConflictError(session.getRevision());
      const candidate = createGraphSession(session.read().graph).apply(parsed.operations, 0).graph;
      const result = await publish(candidate, parsed.expectedRevision); broadcast(result); return result;
    });
    writeJSON(response, 200, { success: true, ...snapshot });
  }
  const server = createServer((request, response) => {
    handle(request, response).catch(error => writeJSON(response, error instanceof GraphConflictError ? 409 : 400,
      { error: error instanceof GraphConflictError ? 'The update conflicts with the current graph.' : 'Invalid diagram update.', revision: session.getRevision() }));
  });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/updates' || !localRequest(request, port) || rateLimit(request.socket.remoteAddress ?? 'local')) { socket.destroy(); return; }
    sockets.handleUpgrade(request, socket, head, client => sockets.emit('connection', client));
  });
  sockets.on('connection', client => {
    client.send(JSON.stringify({ type: 'graph', ...session.read() }));
    client.on('error', () => client.close());
    client.on('message', data => {
      if (rateLimit('websocket')) { client.close(1008, 'Rate limit exceeded.'); return; }
      serialize(async () => {
        const message = editSchema.parse(JSON.parse(data.toString()));
        const snapshot = await publish(message.graph as ArchitectureGraph, message.expectedRevision);
        if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'ack', ...snapshot }));
        broadcast(snapshot, client);
      }).catch(() => {
        if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'rejected', ...session.read() }));
      });
    });
  });
  options.onHTML?.(currentHTML);
  await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(options.port, '127.0.0.1', accept); });
  port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`, read: session.read, setSource,
    reportError() { for (const client of sockets.clients) if (client.readyState === WebSocket.OPEN) client.send('{"type":"error"}'); },
    close: () => new Promise<void>(resolve => {
      for (const client of sockets.clients) client.terminate();
      sockets.close(); server.close(() => resolve());
    }),
  };
}
